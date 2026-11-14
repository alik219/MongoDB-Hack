"""Chunk, redact, embed and load Clientdata/ into Atlas for filtered vector search.

    python -m scripts.ingest_clientdata                 # dry run: write build/clientdata_chunks.jsonl only
    python -m scripts.ingest_clientdata --load          # embed changed chunks (Voyage) and upsert into Atlas
    python -m scripts.ingest_clientdata --create-index  # create the vector search index (idempotent)
    python -m scripts.ingest_clientdata --search "why was the line of credit referred" --client C1

Metadata comes from the folder layout and file names, plus each file's own header table
or YAML front matter:

    ClientSnapshot/C3_business_tech_owner.md          -> client C3, segment business, sub_segment tech_owner
    GoalPreferences/C1_Goal_Preference.md             -> client C1
    MeetingNotes/C1_Maya_Chen/202611_C1_Meeting.md    -> client C1, year 2026, month 11
    ApprovalPolicy/TD_Mortgage_Approval.md            -> bank TD, product mortgage

Chunking: one chunk per meeting, one per `##` section for snapshots and goals (product checks
6a/6b/6c split out), one per approval policy. SINs and business numbers are dropped and exact
credit scores become bands before anything is embedded.

Env: MONGODB_URI (or MDB_MCP_CONNECTION_STRING), VOYAGE_API_KEY (or MDB_MCP_VOYAGE_API_KEY),
MONGODB_DB (default "hackathon").
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "Clientdata"
OUT_PATH = ROOT / "build" / "clientdata_chunks.jsonl"

COLLECTION = "client_knowledge"
INDEX_NAME = "client_knowledge_vec"
EMBED_MODEL = "voyage-3.5"
EMBED_DIMS = 1024
INGEST_SOURCE = "Clientdata"

# Sections that only an underwriter should retrieve (Track 1 field-sensitivity idea).
UNDERWRITER_SECTIONS = {"3", "8"}

FILTER_FIELDS = [
    "doc_type", "client_id", "segment", "year", "date",
    "bank", "product", "status", "visibility", "meeting_type",
]


# --------------------------------------------------------------------------- parsing helpers

def split_front_matter(text: str) -> tuple[dict, str]:
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end != -1:
            return yaml.safe_load(text[4:end]) or {}, text[end + 5:]
    return {}, text


def header_table(text: str) -> dict[str, str]:
    """First two-column `| Field | Value |` table in the file, as a dict."""
    fields: dict[str, str] = {}
    for line in text.splitlines():
        m = re.match(r"^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$", line)
        if m and not set(m.group(1)) <= {"-"} and m.group(1) != "Field":
            fields[m.group(1)] = m.group(2)
        elif fields and not line.startswith("|"):
            break
    return fields


def strip_disclaimer(text: str) -> str:
    """Drop the leading `> SYNTHETIC DATA ...` / `> SIMULATED POLICY ...` blockquote."""
    return re.sub(r"(?m)^>.*\n?", "", text, count=0).strip()


def split_sections(body: str) -> list[tuple[str | None, str]]:
    """Split markdown on `## ` headings -> [(heading or None for preamble, text)]."""
    parts = re.split(r"(?m)^(?=## )", body)
    out = []
    for p in parts:
        if not p.strip():
            continue
        m = re.match(r"## (.+)\n", p)
        out.append((m.group(1).strip() if m else None, p.strip()))
    return out


def section_number(heading: str) -> tuple[str | None, str]:
    m = re.match(r"(\d+[a-z]?)\.\s*(.+)", heading)
    return (m.group(1), m.group(2).strip()) if m else (None, heading.strip())


def parse_date(s: str | None) -> datetime | None:
    if not s:
        return None
    s = str(s).strip()
    for fmt in ("%Y-%m-%d", "%Y-%m", "%Y%m"):
        try:
            return datetime.strptime(s[: len(datetime.now().strftime(fmt))], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def normalize_meeting_type(raw: str) -> str:
    r = raw.lower()
    if "video" in r:
        return "video"
    if "branch" in r:
        return "in_branch"
    if "person" in r or "office" in r:
        return "in_person"
    return "other"


# --------------------------------------------------------------------------- redaction

SCORE_BANDS = [(800, "Exceptional (800+)"), (700, "Good (700 to 799)"),
               (600, "Fair (600 to 699)"), (300, "Poor (below 600)")]


def score_band(score: int) -> str:
    for floor, label in SCORE_BANDS:
        if score >= floor:
            return label
    return "Unknown"


def find_scores(text: str) -> set[int]:
    """Exact personal credit scores mentioned anywhere in a file."""
    scores = {int(s) for s in re.findall(r"Credit score \([^)]*\)\s*\|\s*(\d{3})\b", text)}
    scores |= {int(s) for s in re.findall(r"(?i)\bscore\s*\**\s*(\d{3})\b", text)}
    scores |= {int(s) for s in re.findall(r"(?i)credit score\s*\|\s*(\d{3})\b", text)}
    return scores


def redact(text: str, scores: set[int] | None = None) -> str:
    """Remove identifiers and exact personal credit scores before embedding.

    `scores` should be learned from the whole file (find_scores), because a section such as
    "6a. Credit card" may repeat a score without saying "credit score" next to it.
    """
    # 1. Table rows holding a SIN or business number value.
    text = re.sub(r"(?m)^\|\s*(SIN|Business number)\s*\|[^|\n]*\d[^|\n]*\|.*\n?", "", text)
    text = re.sub(r"\b\d{3}-\d{3}-\d{3}\b", "[REDACTED]", text)
    # 2. Exact personal credit scores -> band: replace every standalone occurrence.
    scores = (scores or set()) | find_scores(text)
    for s in sorted(scores, reverse=True):
        if 300 <= s <= 900:
            text = re.sub(rf"(?<![\d$.,]){s}(?![\d,%]|\.\d)", score_band(s), text)
    # 3. "(18 points short)" would let a reader back out the exact score.
    text = re.sub(r"\(\d+ points short\)", "(below threshold)", text)
    return text


# --------------------------------------------------------------------------- chunk builders

def base_chunk(rel: str, doc_type: str, **meta) -> dict:
    d = {
        "doc_type": doc_type, "client_id": None, "client_ref": None, "client_name": None,
        "segment": None, "sub_segment": None, "date": None, "year": None, "year_month": None,
        "section": None, "section_title": None, "bank": None, "product": None, "status": None,
        "visibility": "advisor", "source_path": rel, "ingest_source": INGEST_SOURCE,
    }
    d.update(meta)
    return d


def finish(chunk: dict, label: str, body: str, idx: int, scores: set[int] | None = None) -> dict:
    chunk["chunk_index"] = idx
    chunk["_id"] = f"{chunk['source_path']}#{chunk['section'] or idx}"
    chunk["text"] = f"{label}\n\n{redact(body, scores)}".strip()
    if chunk["date"] is not None:
        chunk["year"] = chunk["date"].year
        chunk["year_month"] = chunk["date"].strftime("%Y-%m")
    hashed = {k: v for k, v in chunk.items() if k != "content_hash"}
    chunk["content_hash"] = hashlib.sha256(
        (EMBED_MODEL + json.dumps(hashed, default=str, sort_keys=True)).encode()).hexdigest()
    return chunk


def load_clients(data_dir: Path) -> dict[str, dict]:
    """Client registry from ClientSnapshot/: id, ref, name, segment (from the file name)."""
    clients = {}
    for f in sorted((data_dir / "ClientSnapshot").glob("C*_*.md")):
        cid, segment, *rest = f.stem.split("_")
        text = f.read_text()
        title = re.search(r"(?m)^# (.+)$", text).group(1)
        name = re.sub(r"^C\d+\s*[—-]\s*", "", title)
        name = re.sub(r"\s*\([^)]*\)\s*$", "", name).strip()
        ref = re.search(r"\|\s*Client ID\s*\|\s*([^|]+?)\s*\|", text)
        clients[cid] = {
            "client_id": cid, "client_ref": ref.group(1) if ref else None, "client_name": name,
            "segment": segment, "sub_segment": "_".join(rest) or None,
        }
    return clients


def client_meta(clients: dict, cid: str) -> dict:
    c = clients.get(cid, {"client_id": cid})
    return {k: c.get(k) for k in ("client_id", "client_ref", "client_name", "segment", "sub_segment")}


def snapshot_chunks(f: Path, rel: str, clients: dict) -> list[dict]:
    cid = f.stem.split("_")[0]
    meta = client_meta(clients, cid)
    raw = f.read_text()
    scores = find_scores(raw)
    body = strip_disclaimer(re.sub(r"(?m)^# .+\n", "", raw, count=1))
    chunks, idx = [], 0
    for heading, text in split_sections(body):
        if heading is None or heading.lower().startswith("how to read"):
            continue
        num, title = section_number(heading)
        if heading.lower() == "at a glance":
            num, title = "0", "At a glance"
        subs = re.split(r"(?m)^(?=### )", text)
        intro, subsections = subs[0], subs[1:]
        pieces = []
        if subsections:
            for s in subsections:
                sh = re.match(r"### (.+)\n", s).group(1)
                snum, stitle = section_number(sh)
                pieces.append((snum or num, stitle, f"{intro.strip()}\n\n{s.strip()}"))
        else:
            pieces.append((num, title, text))
        for snum, stitle, stext in pieces:
            vis = "underwriter" if (snum or "").rstrip("abc") in UNDERWRITER_SECTIONS else "advisor"
            c = base_chunk(rel, "client_snapshot", section=snum, section_title=stitle,
                           visibility=vis, **meta)
            label = f"{cid} {meta['client_name']} · Client snapshot · {snum}. {stitle}"
            chunks.append(finish(c, label, stext, idx, scores))
            idx += 1
    return chunks


def goal_chunks(f: Path, rel: str, clients: dict) -> list[dict]:
    cid = f.stem.split("_")[0]
    meta = client_meta(clients, cid)
    raw = f.read_text()
    scores = find_scores(raw)
    hdr = header_table(raw)
    date = parse_date(hdr.get("Effective date"))
    advisor = re.sub(r",.*$", "", hdr.get("Advisor", "")) or None
    body = strip_disclaimer(re.sub(r"(?m)^# .+\n", "", raw, count=1))
    chunks, idx = [], 0
    for heading, text in split_sections(body):
        if heading is None:
            continue
        num, title = section_number(heading)
        c = base_chunk(rel, "goal_preference", section=num, section_title=title,
                       date=date, advisor=advisor, **meta)
        label = f"{cid} {meta['client_name']} · Goals and preferences · {num}. {title}"
        chunks.append(finish(c, label, text, idx, scores))
        idx += 1
    return chunks


def meeting_chunks(f: Path, rel: str, clients: dict) -> list[dict]:
    yyyymm, cid = f.stem.split("_")[:2]
    meta = client_meta(clients, cid)
    raw = f.read_text()
    hdr = header_table(raw)
    date = parse_date(hdr.get("Meeting date")) or parse_date(yyyymm)
    mtype_raw = hdr.get("Meeting type", "")
    c = base_chunk(
        rel, "meeting_note", date=date, client_folder=f.parent.name,
        meeting_type=normalize_meeting_type(mtype_raw), meeting_type_raw=mtype_raw or None,
        advisor=re.sub(r",.*$", "", hdr.get("Advisor", "")) or None,
        attendees=[a.strip() for a in hdr.get("Attendees", "").split(";") if a.strip()],
        **meta)
    label = f"{cid} {meta['client_name']} · Meeting {date:%Y-%m-%d} · {mtype_raw}"
    return [finish(c, label, strip_disclaimer(raw), 0)]


def policy_chunks(f: Path, rel: str) -> list[dict]:
    fm, body = split_front_matter(f.read_text())
    bank_from_name, product_from_name = f.stem.split("_")[:2]
    rules = None
    m = re.search(r"```yaml\n(.*?)```", body, re.S)
    if m:
        rules = (yaml.safe_load(m.group(1)) or {}).get("decision_rules")
    c = base_chunk(
        rel, "approval_policy",
        bank=fm.get("bank", bank_from_name),
        product=fm.get("product", slug(product_from_name)),
        product_code=product_from_name,
        policy_id=fm.get("policy_id"), version=str(fm.get("version")) if fm.get("version") else None,
        status=fm.get("status"), date=parse_date(fm.get("effective_date")),
        policy=rules)
    label = f"{c['bank']} · {c['product']} approval policy · {c['policy_id']} v{c['version']}"
    return [finish(c, label, strip_disclaimer(body), 0)]


def build_chunks(data_dir: Path = DATA_DIR) -> list[dict]:
    clients = load_clients(data_dir)
    chunks: list[dict] = []
    for f in sorted(data_dir.rglob("*.md")):
        rel = f.relative_to(data_dir).as_posix()
        top = rel.split("/")[0]
        if top == "ClientSnapshot":
            chunks += snapshot_chunks(f, rel, clients)
        elif top == "GoalPreferences":
            chunks += goal_chunks(f, rel, clients)
        elif top == "MeetingNotes":
            chunks += meeting_chunks(f, rel, clients)
        elif top == "ApprovalPolicy":
            chunks += policy_chunks(f, rel)
        else:
            print(f"skip (unknown folder): {rel}", file=sys.stderr)
    ids = [c["_id"] for c in chunks]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise ValueError(f"duplicate chunk ids: {sorted(dupes)}")
    return chunks


# --------------------------------------------------------------------------- Voyage + Atlas

def env(*names: str) -> str:
    for n in names:
        if os.environ.get(n):
            return os.environ[n]
    sys.exit(f"Missing env var: one of {', '.join(names)}")


# Voyage accounts without a payment method are limited to 3 requests and 10K tokens per minute.
# Override with VOYAGE_TPM / VOYAGE_RPM once billing is set up (e.g. VOYAGE_TPM=1000000).
VOYAGE_TPM = int(os.environ.get("VOYAGE_TPM", "8000"))
VOYAGE_RPM = int(os.environ.get("VOYAGE_RPM", "3"))
_last_call = 0.0
_last_tokens = 0


def approx_tokens(text: str) -> int:
    # Measured on this data: ~2 Voyage tokens per whitespace word (tables, numbers, symbols).
    return int(len(text.split()) * 2.2) + 8


def token_batches(texts: list[str], max_tokens: int, max_items: int = 128) -> list[list[int]]:
    """Group indexes so each request stays under the per-minute token budget."""
    batches, cur, cur_tokens = [], [], 0
    for i, t in enumerate(texts):
        n = approx_tokens(t)
        if cur and (cur_tokens + n > max_tokens or len(cur) >= max_items):
            batches.append(cur)
            cur, cur_tokens = [], 0
        cur.append(i)
        cur_tokens += n
    if cur:
        batches.append(cur)
    return batches


def _voyage_request(inputs: list[str], input_type: str) -> list[list[float]]:
    global _last_call, _last_tokens
    key = env("VOYAGE_API_KEY", "MDB_MCP_VOYAGE_API_KEY")
    payload = json.dumps({"input": inputs, "model": EMBED_MODEL, "input_type": input_type}).encode()
    # Space requests so neither the request nor the token budget per minute is exceeded.
    min_gap = max(60.0 / VOYAGE_RPM, 60.0 * _last_tokens / VOYAGE_TPM)
    for attempt in range(6):
        wait = _last_call + min_gap - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
        _last_tokens = sum(approx_tokens(t) for t in inputs)
        req = urllib.request.Request(
            "https://api.voyageai.com/v1/embeddings", data=payload,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.load(r)["data"]
            return [d["embedding"] for d in sorted(data, key=lambda d: d["index"])]
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 5:
                print(f"  Voyage {e.code}, waiting 60s and retrying…", flush=True)
                time.sleep(60)
                continue
            sys.exit(f"Voyage API error {e.code}: {e.read().decode()[:300]}")
    raise RuntimeError("unreachable")


def embed_batches(texts: list[str], input_type: str):
    """Yield (indexes, vectors) per throttled request, so callers can save as they go."""
    for idxs in token_batches(texts, VOYAGE_TPM):
        yield idxs, _voyage_request([texts[i] for i in idxs], input_type)


def embed(texts: list[str], input_type: str) -> list[list[float]]:
    out: list[list[float] | None] = [None] * len(texts)
    for idxs, vecs in embed_batches(texts, input_type):
        for i, v in zip(idxs, vecs):
            out[i] = v
    return out  # type: ignore[return-value]


def get_collection():
    from dotenv import load_dotenv
    from pymongo import MongoClient
    load_dotenv(ROOT / ".env")
    client = MongoClient(env("MONGODB_URI", "MDB_MCP_CONNECTION_STRING"))
    return client[os.environ.get("MONGODB_DB", "hackathon")][COLLECTION]


def load(chunks: list[dict]) -> None:
    from pymongo import ReplaceOne
    coll = get_collection()
    existing = {d["_id"]: d.get("content_hash") for d in
                coll.find({"ingest_source": INGEST_SOURCE}, {"content_hash": 1})}
    todo = [c for c in chunks if existing.get(c["_id"]) != c["content_hash"]]
    print(f"{len(chunks)} chunks, {len(todo)} new or changed, {len(chunks) - len(todo)} unchanged")
    if todo:
        texts = [c["text"] for c in todo]
        n_batches = len(token_batches(texts, VOYAGE_TPM))
        print(f"embedding in {n_batches} requests (≤{VOYAGE_TPM} tokens, {VOYAGE_RPM}/min); "
              f"progress is saved after each one", flush=True)
        done = 0
        for b, (idxs, vecs) in enumerate(embed_batches(texts, "document"), 1):
            now = datetime.now(timezone.utc)
            ops = [ReplaceOne({"_id": todo[i]["_id"]},
                              {**todo[i], "embedding": v, "embedding_model": EMBED_MODEL,
                               "ingested_at": now}, upsert=True)
                   for i, v in zip(idxs, vecs)]
            coll.bulk_write(ops, ordered=False)
            done += len(idxs)
            print(f"  batch {b}/{n_batches}: saved {done}/{len(todo)}", flush=True)
    stale = set(existing) - {c["_id"] for c in chunks}
    if stale:
        coll.delete_many({"_id": {"$in": sorted(stale)}})
        print(f"removed {len(stale)} chunks whose source no longer exists")


def create_index() -> None:
    from pymongo.operations import SearchIndexModel
    coll = get_collection()
    definition = {"fields": [{"type": "vector", "path": "embedding",
                              "numDimensions": EMBED_DIMS, "similarity": "cosine"}]
                  + [{"type": "filter", "path": p} for p in FILTER_FIELDS]}
    names = {ix["name"] for ix in coll.list_search_indexes()}
    if INDEX_NAME in names:
        coll.update_search_index(INDEX_NAME, definition)
        print(f"updated search index {INDEX_NAME}")
    else:
        coll.create_search_index(SearchIndexModel(definition=definition, name=INDEX_NAME,
                                                  type="vectorSearch"))
        print(f"created search index {INDEX_NAME}")
    for _ in range(60):
        ix = next(i for i in coll.list_search_indexes() if i["name"] == INDEX_NAME)
        if ix.get("queryable"):
            print("index is queryable")
            return
        time.sleep(5)
    print("index still building; check Atlas > Search & Vector Search")


RESULT_FIELDS = ["doc_type", "client_id", "client_ref", "client_name", "segment", "section",
                 "section_title", "date", "year_month", "meeting_type", "advisor", "bank",
                 "product", "policy_id", "version", "status", "policy", "visibility",
                 "source_path", "text"]
ROLE_VISIBILITY = {"advisor": ["advisor"], "underwriter": ["advisor", "underwriter"]}


def build_filter(role: str = "advisor", client_id=None, doc_type=None, bank=None, product=None,
                 segment=None, meeting_type=None, status=None, since=None, until=None) -> dict:
    """Pre-filter for $vectorSearch. List values become $in; `role` always restricts visibility."""
    if role not in ROLE_VISIBILITY:
        raise ValueError(f"role must be one of {sorted(ROLE_VISIBILITY)}")
    flt: dict = {"visibility": {"$in": ROLE_VISIBILITY[role]}}
    for field, val in (("client_id", client_id), ("doc_type", doc_type), ("bank", bank),
                       ("product", product), ("segment", segment),
                       ("meeting_type", meeting_type), ("status", status)):
        if val:
            flt[field] = {"$in": list(val)} if isinstance(val, (list, tuple, set)) else val
    date_rng = {}
    if since:
        date_rng["$gte"] = since if isinstance(since, datetime) else parse_date(since)
    if until:
        date_rng["$lte"] = until if isinstance(until, datetime) else parse_date(until)
    if date_rng:
        flt["date"] = date_rng
    return flt


def retrieve(query: str, k: int = 5, role: str = "advisor", **filters) -> list[dict]:
    """Semantic search over client_knowledge. The tool entry point for other processes.

    filters: client_id, doc_type, bank, product, segment, meeting_type, status (str or list),
             since / until ("YYYY-MM-DD"). Returns dicts with RESULT_FIELDS plus "score".
    """
    flt = build_filter(role=role, **filters)
    qv = embed([query], "query")[0]
    stage = {"index": INDEX_NAME, "path": "embedding", "queryVector": qv,
             "numCandidates": max(100, k * 20), "limit": k, "filter": flt}
    project = {f: 1 for f in RESULT_FIELDS}
    project["score"] = {"$meta": "vectorSearchScore"}
    return list(get_collection().aggregate([{"$vectorSearch": stage}, {"$project": project}]))


def search(query: str, k: int, role: str = "advisor", **filters) -> None:
    print(f"filter: {build_filter(role=role, **filters)}")
    for d in retrieve(query, k, role, **filters):
        snippet = " ".join(d["text"].split())[:160]
        print(f"\n{d['score']:.3f}  {d['_id']}\n       {snippet}…")


# --------------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--load", action="store_true", help="embed and upsert into Atlas")
    ap.add_argument("--create-index", action="store_true", help="create/update the vector index")
    ap.add_argument("--search", metavar="QUERY", help="run a filtered vector search")
    ap.add_argument("--client", help="filter: client_id, e.g. C1")
    ap.add_argument("--doc-type", help="filter: client_snapshot | goal_preference | meeting_note | approval_policy")
    ap.add_argument("--bank", help="filter: bank, e.g. TD")
    ap.add_argument("--product", help="filter: product, e.g. mortgage")
    ap.add_argument("--since", help="filter: date >= YYYY-MM-DD")
    ap.add_argument("--until", help="filter: date <= YYYY-MM-DD")
    ap.add_argument("--role", default="advisor", choices=sorted(ROLE_VISIBILITY),
                    help="caller role; advisor cannot see underwriter-only chunks")
    ap.add_argument("--json", action="store_true", help="print results as JSON")
    ap.add_argument("-k", type=int, default=5)
    args = ap.parse_args(argv)

    if args.search:
        filters = dict(client_id=args.client, doc_type=args.doc_type, bank=args.bank,
                       product=args.product, since=args.since, until=args.until)
        if args.json:
            print(json.dumps(retrieve(args.search, args.k, args.role, **filters),
                             default=str, indent=2, ensure_ascii=False))
        else:
            search(args.search, args.k, args.role, **filters)
        return

    chunks = build_chunks()
    OUT_PATH.parent.mkdir(exist_ok=True)
    with OUT_PATH.open("w") as fh:
        for c in chunks:
            fh.write(json.dumps(c, default=str) + "\n")
    by_type: dict[str, int] = {}
    for c in chunks:
        by_type[c["doc_type"]] = by_type.get(c["doc_type"], 0) + 1
    print(f"wrote {len(chunks)} chunks to {OUT_PATH.relative_to(ROOT)}: {by_type}")

    if args.load:
        load(chunks)
    if args.create_index:
        create_index()


if __name__ == "__main__":
    main()

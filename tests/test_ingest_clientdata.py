"""Chunking, metadata and redaction for scripts/ingest_clientdata.py (no Atlas, no Voyage)."""
import re

import pytest

from scripts.ingest_clientdata import DATA_DIR, build_chunks, build_filter, redact

pytestmark = pytest.mark.skipif(not DATA_DIR.exists(), reason="Clientdata/ not present")


@pytest.fixture(scope="module")
def chunks():
    return build_chunks()


def by_id(chunks, _id):
    return next(c for c in chunks if c["_id"] == _id)


def test_counts_per_doc_type(chunks):
    counts = {}
    for c in chunks:
        counts[c["doc_type"]] = counts.get(c["doc_type"], 0) + 1
    meeting_files = list((DATA_DIR / "MeetingNotes").rglob("*.md"))
    policy_files = list((DATA_DIR / "ApprovalPolicy").glob("*.md"))
    assert counts["meeting_note"] == len(meeting_files)
    assert counts["approval_policy"] == len(policy_files)
    assert counts["client_snapshot"] > 0 and counts["goal_preference"] > 0


def test_ids_unique(chunks):
    ids = [c["_id"] for c in chunks]
    assert len(ids) == len(set(ids))


def test_no_identifiers_or_exact_scores_leak(chunks):
    text = "\n".join(c["text"] for c in chunks)
    assert not re.search(r"\b\d{3}-\d{3}-\d{3}\b", text), "SIN-shaped number in chunk text"
    assert "RC0001" not in text, "business number in chunk text"
    for score in (662, 745, 812, 770):
        assert not re.search(rf"(?<![\d$.,]){score}(?![\d,%])", text), f"exact score {score} leaked"


def test_meeting_metadata_from_path_and_header(chunks):
    c = by_id(chunks, "MeetingNotes/C1_Maya_Chen/202611_C1_Meeting.md#0")
    assert c["client_id"] == "C1"
    assert c["client_ref"] == "C1-STU-001"
    assert c["segment"] == "retail" and c["sub_segment"] == "student"
    assert c["date"].strftime("%Y-%m-%d") == "2026-11-01"
    assert c["year"] == 2026 and c["year_month"] == "2026-11"
    assert c["meeting_type"] in {"video", "in_person", "in_branch"}
    assert c["text"].startswith("C1 Maya Chen · Meeting 2026-11-01")


def test_snapshot_product_checks_split(chunks):
    sections = {c["section"] for c in chunks if c["source_path"] == "ClientSnapshot/C1_retail_student.md"}
    assert {"0", "6a", "6b", "6c"} <= sections
    assert by_id(chunks, "ClientSnapshot/C1_retail_student.md#3")["visibility"] == "underwriter"
    assert by_id(chunks, "ClientSnapshot/C1_retail_student.md#6b")["visibility"] == "advisor"


def test_policy_front_matter_and_rules(chunks):
    c = by_id(chunks, "ApprovalPolicy/TD_Mortgage_Approval.md#0")
    assert (c["bank"], c["product"], c["status"]) == ("TD", "mortgage", "current")
    assert c["policy_id"] == "TD-MORTGAGE-2026-09"
    assert c["policy"]["min_credit_score"] == 660
    assert c["client_id"] is None


def test_redact_unit():
    src = "| SIN | 000-000-009 (placeholder) |\n| Credit score (Equifax) | 701 |\nScore / utilization | 701 / 9% |\n$701 fee"
    out = redact(src)
    assert "000-000-009" not in out and "| SIN |" not in out
    assert "701 |" not in out and "701 /" not in out
    assert "Good (700 to 799)" in out
    assert "$701" in out  # dollar amounts untouched


def test_build_filter_role_and_lists():
    assert build_filter() == {"visibility": {"$in": ["advisor"]}}
    f = build_filter(role="underwriter", client_id=["C1", "C2"], doc_type="meeting_note",
                     since="2026-01-01")
    assert f["visibility"] == {"$in": ["advisor", "underwriter"]}
    assert f["client_id"] == {"$in": ["C1", "C2"]}
    assert f["doc_type"] == "meeting_note"
    assert f["date"]["$gte"].year == 2026
    with pytest.raises(ValueError):
        build_filter(role="admin")

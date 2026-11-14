# Recall.IQ

An advisor's agent workspace with a governed memory dashboard. Recall.IQ helps a financial advisor follow through on client commitments across conversations, while controlling exactly what the agent remembers, who can read each memory, how long it lives, and how it is corrected or forgotten.

```
client note → proposed memories → advisor confirmation → fresh agent run
   → memory-informed draft follow-ups → correction / expiry / forget → different next run
```

All clients, firms and figures are fictional. The MVP prepares client reviews and follow-up tasks only. It does not give investment recommendations, trade, or move money.

---

## Quick start (demo mode, no credentials)

```bash
npm install
npm run build && npm start     # http://localhost:3000  (or: npm run dev)
npm test                       # 24 unit/integration tests
npm run eval                   # scenario evaluation → docs/EVAL_RESULTS.md
```

With no environment variables, every backing service runs as an explicitly labeled **demo** implementation (see [Live vs. mocked](#live-vs-mocked)). The header badge shows which services are live; click it for details and for **Reset demo data**.

## Running against MongoDB Atlas and live models

1. Create an Atlas cluster (M0 free tier works; Atlas Vector Search is available on all tiers). Add your IP to the access list and create a database user.
2. Copy `.env.example` to `.env` and set:
   - `MONGODB_URI` (Atlas connection string), optional `MONGODB_DB` (default `continuity`).
   - Embeddings: `VOYAGE_API_KEY` (default model `voyage-3.5`, 1024 dims) **or** `OPENAI_API_KEY` (`text-embedding-3-small`, 1536 dims). Override with `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`.
   - Extraction and planning: `ANTHROPIC_API_KEY` (default model `claude-opus-5-5`, configurable with `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`).
3. `npm run atlas:setup` creates the collections with JSON-schema validation, the standard indexes, and the vector index, then waits until it is queryable.
4. `npm run seed` loads the synthetic firms, people, clients, sources and memories (embedded with your configured model).
5. `npm run build && npm start`.

Each service switches independently: you can run real Atlas Vector Search over demo embeddings, or live embeddings with the deterministic planner. If you change embedding model or dimensions, re-run `atlas:setup` and `seed`. Every vector stores `embeddingModel` (`provider:model:dims`), and retrieval filters on it, so vectors from different models are never mixed.

### Atlas schema

| Collection | Purpose |
|---|---|
| `firms`, `users`, `clients` | Server-side identities. A user's firm, role and client assignments come only from here. |
| `sources` | Notes and client messages, stored verbatim as evidence (with a content hash and any flagged instruction-like text). |
| `memories` | One document per **version**: `lineageId`, `version`, firm/client scope, category, statement, structured `{topic, attributes}`, `status`, `basis` (source-supported vs advisor-confirmed), `evidence[]` (verbatim excerpts), `visibility` + `allowedUserIds`, `expiresAt`/`reviewAt`, `retrievalExpiresAt`, embedding + model metadata, proposal metadata. |
| `tasks` | Follow-ups with `dependsOn[{memoryId, lineageId, version}]`, status, review flags, history, and the runs that created/revised them. |
| `runs` | Run evidence: request, stages, retrieved memory ids+versions+similarity, policy decisions, pending changes, proposed vs applied vs rejected actions, errors, stale reason. |
| `audit_events` | Minimal audit trail (who, what, when). No memory text. |
| `forget_tombstones` | One-way fingerprints that block re-creating forgotten memories. |

Vector index (`memory_vector_index` on `memories`, created by `scripts/atlas-setup.ts`):

```json
{ "fields": [
  { "type": "vector", "path": "embedding", "numDimensions": 1024, "similarity": "cosine" },
  { "type": "filter", "path": "firmId" },       { "type": "filter", "path": "clientId" },
  { "type": "filter", "path": "status" },       { "type": "filter", "path": "visibility" },
  { "type": "filter", "path": "allowedUserIds" },{ "type": "filter", "path": "retrievalExpiresAt" },
  { "type": "filter", "path": "embeddingModel" } ] }
```

Retrieval query (`src/lib/store/mongo-store.ts`, filter built in `src/lib/policy.ts`):

```js
{ $vectorSearch: { index: "memory_vector_index", path: "embedding", queryVector, numCandidates: 240, limit: 12,
    filter: { $and: [ { firmId }, { clientId }, { status: "active" }, { embeddingModel },
                      { retrievalExpiresAt: { $gt: now } },
                      { $or: [ { visibility: "team" }, { allowedUserIds: userId } ] } ] } } }
```

`retrievalExpiresAt` is `expiresAt`, or a far-future sentinel when there is no expiry, so expiry can be pre-filtered without relying on null handling.

---

## Architecture

```
Browser (Next.js client components)
  │  persona cookie only — no firm/client/role/access data is trusted from the browser
  ▼
API routes (src/app/api/*)  ──►  handle(): session → AuthContext (from users collection)
  ▼
Services (src/lib/services)
  memories.ts  ingest → extract → verify excerpts → tombstone/dup checks → proposals
               approve / reject / correct / restrict / expire / reconfirm / forget / export
  agent.ts     7-stage run (below)
  tasks.ts     approve (lead only, revalidates memory versions) / withdraw / complete / "Why this?"
  clients.ts   client list, session info, comparison runs, activity
  ▼
Policy (src/lib/policy.ts)   retrieval pre-filter + in-code eligibility re-check
AI adapters (src/lib/ai)     embeddings (Voyage / OpenAI / demo), extractor + planner (Anthropic / demo rules)
Store (src/lib/store)        MongoStore (official driver, $vectorSearch) | DemoStore (same filter semantics)
```

**Agent run** (`runAgent`):

1. **Checking access**: firm and role from the session; the client must belong to the firm and the user must be assigned to it (cross-firm returns 404, unassigned 403).
2. **Loading open follow-ups** visible to the user.
3. **Retrieving memories** with `$vectorSearch`, pre-filtered by firm, client, status, expiry, access and embedding model, so private memories never become candidates.
4. **Checking freshness & conflicts**: every candidate is re-checked in code; review-due memories are flagged; unconfirmed update/conflict proposals are passed separately as *pending*, never as facts; exclusions are recorded as policy decisions.
5. **Preparing follow-ups**: the planner returns a brief and actions limited to `create_task | revise_task | withdraw_task | keep_task`. It has no tools and no database access.
6. **Validating output & citations**: Zod schema validation; any action citing a memory outside the eligible retrieved set is rejected; bad brief citations are stripped; duplicate creates are converted into revisions of the open task with the same key.
7. **Revalidating & saving**: cited memories are re-read right before writing. If any was corrected, forgotten, expired or restricted mid-run, the run is marked **stale** and nothing is saved. Otherwise tasks are persisted with exact memory-version dependencies, and approved tasks are never rewritten by the agent (they are flagged for the advisor instead).

**Memory lifecycle**: `proposed → active → superseded` (correction or confirmed update creates version n+1), plus `rejected`, `forgotten`, and `expired` (derived at read time from `expiresAt`, never from a cleanup job). Confirming an update or correcting a memory flags every open task that depends on the old version (`needsReview`), and the next run withdraws or revises those tasks, explaining which version change caused it.

**Forget semantics** (`forgetMemory`):
- every version is immediately excluded from retrieval (`status: forgotten`);
- statement, structured content, excerpts and embeddings are removed from the memory documents;
- memory text copied into run records (retrieved snapshots, brief points) is redacted;
- a tombstone of one-way fingerprints (normalized statement, source-hash+excerpt) blocks the same source or statement from recreating it;
- kept: ids, category, timestamps, actor, reason, fingerprints;
- retained separately: the original source document (the firm's record) and historical task text. **This is retrieval exclusion plus content removal from memory, not erasure of the source.** Atlas backups and oplog retention are outside the app's control.

**Access control**: identity comes from a demo persona cookie that selects a server-defined user. This is clearly labeled and is **not production authentication**. Every request re-derives firm, role and client assignments from the database. Restricted memories are filtered inside vector search and on every read path: memory lists, details, version history, source previews, task lists and "Why this?", run records (masked per viewer), comparison runs, and export. Text inside notes (for example "ignore all access restrictions") is flagged and stored as evidence only; it never reaches authorization logic.

**Evidence**: every memory carries verbatim excerpts. Ingestion discards any extracted memory whose excerpt is not an exact substring of the source. The UI distinguishes **Source-supported · unconfirmed** from **Advisor-confirmed** and never shows model confidence. Vector similarity is shown only as "sim (ranking only)".

## Live vs. mocked

| Capability | Live path (with credentials) | Demo path (no credentials) |
|---|---|---|
| Storage | MongoDB Atlas via official driver, JSON-schema validated collections | In-process store persisted to `.data/demo-store.json`, evaluating the same filter objects |
| Vector retrieval | Atlas `$vectorSearch` with pre-filter | Exact cosine in app code after applying the same pre-filter. **Not Atlas.** |
| Embeddings | Voyage AI or OpenAI embeddings API | Deterministic feature hashing (256d). **Not a semantic model.** |
| Memory extraction | Anthropic Messages API, structured output, server-validated | Deterministic regex rules tuned to the sample notes |
| Planning (brief + task actions) | Anthropic Messages API, structured output, server-validated | Deterministic rules over structured memory topics |
| Auth | Demo persona cookie backed by server-side users (both modes) | Same |

Every run records which implementation produced it, and the header badge shows LIVE/DEMO per service.

### Verified in this build

- `npm test`: 24/24 passing (demo services).
- `npm run eval`: 16/16 scenario checks passing with the demo planner/extractor. See `docs/EVAL_RESULTS.md`.
- `npm run build`: succeeds; the full demo story was exercised in a headless browser.

### Not yet verified

- The Atlas path (`MongoStore`, `atlas:setup`, `$vectorSearch`) compiles against the official driver, but **has not been run against a live cluster** in this build.
- The Anthropic extractor/planner and the Voyage/OpenAI adapters **have not been called with real keys** here. The LLM planner's outputs will vary; server-side validation, citation checks and reconciliation apply equally to it, but the scenario expectations were tuned against the deterministic planner.

### Known limitations

- Demo authentication only; no SSO, sessions or CSRF hardening.
- Multi-document changes (supersede + insert) use optimistic version checks rather than Atlas transactions.
- Task keys from an LLM planner are free-form snake_case; reconciliation relies on the model reusing keys from `openTasks` (it is told to, and duplicates of an existing key are converted into revisions).
- Plain-text notes only (paste or `.txt`/`.md` upload). No PDF, email or portfolio integrations.
- The demo extractor only understands phrasing similar to the sample notes.
- Expired memories are excluded on read, but nothing auto-archives them.

## Project layout

```
src/app/(workspace|memory|clients|activity|compare)   UI pages
src/app/api/*                                        route handlers
src/lib/services/*                                   domain services
src/lib/ai/*                                         embeddings, extractor, planner, Anthropic adapter
src/lib/store/*                                      Atlas + demo stores
src/lib/policy.ts, auth.ts                           authorization
src/lib/seed.ts, samples.ts                          synthetic data
scripts/atlas-setup.ts, seed.ts, eval.ts
tests/continuity.test.ts
docs/DEMO_SCRIPT.md, docs/EVAL_RESULTS.md
```

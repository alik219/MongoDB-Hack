# Governed-Memory Financial Advisor Agent — Plan

Track: **2. Memory You Can Govern**. The Track 1 hash-chained audit log is reused so every memory change can be accounted for.

> "What an agent remembers is data someone has to answer for." The agent uses MongoDB Atlas and Vector Search to store and retrieve memory that changes what it does on the next run. There are rules for who can read each memory, how long it lives, and how it gets corrected or forgotten.

Sources: [MongoDB AI agents](https://www.mongodb.com/docs/vector-search/about/ai-agents/?interface=driver&language=python) · [LangGraph + MongoDB](https://www.mongodb.com/docs/atlas/ai-integrations/langgraph/)

---

## 1. Four kinds of memory, each with a MongoDB tool

| Memory | What it holds | MongoDB tool | Lifetime |
|---|---|---|---|
| **Reference knowledge** (read-only) | Profiles, goals, meeting notes, bank policies (`hackathon.client_knowledge`, 177 chunks) | `MongoDBAtlasVectorSearch` (`langchain-mongodb`) on `client_knowledge_vec`, with pre-filters | Changes only when `Clientdata/` is reloaded |
| **Conversation memory** | The current conversation's state | `MongoDBSaver` (`langgraph-checkpoint-mongodb`), one `thread_id` per session | TTL, e.g. 24 h |
| **What the agent learned** (governed) | Facts and preferences picked up about a client | `MongoDBStore` (`langgraph-store-mongodb`) with semantic search, stored per client | Depends on the kind of memory (section 3) |
| **Memory history** | Every memory write, read, correction and deletion: who did it and why | Hash-chained `audit_log` (`app/audit.py`) + change streams | Never deleted |

The embedding model must match: `VoyageAIEmbeddings(model="voyage-3.5")`, the same model the existing vectors were made with.

## 2. LangGraph agent flow

```
client session (role and client_id come from the login, never from the LLM)
   │
   ▼
load_context ── fixed lookup, no LLM choice: client summary + current memories for this client
   │
   ▼
advisor_agent (Claude) ⇄ tools
   │
   ▼
eligibility_check ── fixed code compares client numbers with each bank's decision_rules
   │
   ▼
memory_writer ── LLM proposes memories → governance gate → MongoDBStore + audit_log
   │
   ▼
answer with citations (source_path / memory id)
```

### Tools

| Tool | How it works in MongoDB |
|---|---|
| `get_client_profile(client_id, topic)` | Vector search, `doc_type=client_snapshot` + `client_id` + role visibility |
| `get_client_preferences(client_id, topic)` | Goal and preference chunks + current learned memories (learned memories take priority) |
| `search_meeting_notes(client_id, query, since)` | Vector search on meeting notes, re-sorted by date (optionally hybrid `$rankFusion`) |
| `list_products(...)` / `get_approval_policy(bank, product)` | Plain `find` on stored policy fields: exact thresholds, no vector search |
| `check_eligibility(client_id, bank, product)` | Fixed code compares the client's ratios with `decision_rules`; the LLM does no arithmetic |
| `remember` / `recall` / `correct_memory` / `forget_memory` | `MongoDBStore` `put` / `search` / `delete`, always through the governance gate |

## 3. Memory rules

Each memory stores: `client_id`, `kind`, `content`, `source`, `created_by`, `visibility`, `status` (active / superseded / forgotten), `supersedes`, `expires_at`, `confirmed_by_client`.

| Rule | How it works |
|---|---|
| **Who can read** | Stored per client (`("client", client_id, "memories")`) + a `visibility` filter from the caller's role, set by the system. Advisor → advisor memories; underwriter → all; client → only their own. |
| **How long it lives** | TTL on `expires_at`, per kind:<br>• a guess the agent inferred: 90 days unless confirmed<br>• a preference the client confirmed: until changed<br>• conversation memory: 24 h<br>• advice actually given (compliance): kept 7 years, hidden but not deleted |
| **Correction** | Never overwrite: a new memory with `supersedes`; the old one becomes `superseded`. Search only returns `status: active`. |
| **Forgetting** | `forget_memory` removes the memory and its embedding; the audit log keeps only a hash and the reason. |
| **What can be written** | The gate runs `redact()` (no SINs or exact scores), checks the kind is allowed, and requires a source. Inferred facts stay `unconfirmed` until confirmed. |

## 4. Demo: memory changes the next run

1. **Run 1:** Maya asks for credit; she says her mom can no longer co-sign → the agent stores a co-signer memory.
2. **Run 2, new session:** the agent no longer suggests a line of credit and recommends a secured card or a small credit-limit increase.
3. **Correction:** "mom can co-sign again" → a new memory replaces the old one, and the recommendation changes back.
4. **Forget:** she asks to delete it → the memory is gone, the audit log shows the erasure, and the reviewer feed shows it live.

## 5. Build order

1. **Done:** packages + read-only knowledge and policy tools on `MongoDBAtlasVectorSearch` (`app/knowledge_tools.py`, role-scoped, tested live).
2. **Done:** tested `MongoDBStore` for governed memory on Atlas. Decision: **use `MongoDBStore`** with the two adjustments below (results in section 6).
3. **Done:** `check_eligibility` tool. `app/eligibility.py` is a fixed-code engine over each policy's `decision_rules`. It reads `hackathon.client_financials` (exact numbers, underwriter-only, transcribed in `app/client_financials.py`), never returns exact scores, and reproduces the snapshots' worked results (C3 mortgage REFER at GDS 34.4% / TDS 39.4%; C2 APPROVE; C1 line of credit REFER with co-signer, DECLINE with `co_signer_available=false`, which is the memory hook).
4. **Done:** LangGraph flow (`app/advisor_graph.py`): `load_context` (exact Mongo lookups of snapshot §0 + goals §1, no embedding calls) → Claude Opus 5.5 advisor ⇄ tools. `MongoDBSaver` stores conversations in `hackathon.checkpoints` / `checkpoint_writes` with a 24 h TTL index; thread ids are `user:client:conversation`. Tested: history survives a restart, underwriter-only text never enters the prompt. Chat CLI: `python -m app.advisor_chat` (needs `ANTHROPIC_API_KEY`).
5. Memory writer + governance gate → `audit_log`.
6. Demo script + reviewer view.

## 6. MongoDBStore test results (step 2, 2026-11-14)

Tested `langgraph-store-mongodb` 0.4.0 with Voyage `voyage-3.5` on a throwaway collection (since dropped).

| Question | Result | How we use it |
|---|---|---|
| Separate memories per client | ✅ A search in `("client","C1","memories")` never returned C2's memory | One key path per client: `("client", client_id, "memories")` |
| Filter by status | ✅ `filter={"status": "active"}` dropped the superseded memory | Corrections set the old memory to `superseded` |
| Filter by role | ✅ with an **array** field: `readers: ["advisor","underwriter"]`, filter `{"readers": "advisor"}` | The store **rejects `$in`** and other operators (equality only), so roles are stored as a `readers` array |
| Separate expiry per memory | ✅ with **our own TTL index** on `value.expires_at` (`expireAfterSeconds=0`); a 20 s memory was gone after ~70 s, and memories without `expires_at` stayed | The store's own `ttl_config` is one TTL for the whole store (on `updated_at`), so we don't use it |
| Forget | ✅ `store.delete(ns, key)` removes the document, and its embedding with it (same document) | `forget_memory` = delete + audit entry |
| Index creation | ✅ The store created and waited for its vector index (~30 s) | Index `agent_memory_vec`, filters `status`, `readers`, `kind`, `client_id` |

Things to watch:
- **Every `put` re-embeds,** even a status-only change such as marking a memory superseded, and each one uses up Voyage rate limit. Batch puts with `store.batch([...])`, which makes one embed call for all of them.
- **TTL deletes happen about once a minute and aren't logged.** The audit entry for an expiring memory must be written at creation time (it records `expires_at`), so the expiry is predictable and accountable.
- **Store filters only allow exact matches,** so date ranges and similar conditions have to be applied after the search, in Python.

## Risks

- **Voyage free tier:** 3 requests / 10K tokens per minute. One agent turn makes several embedding calls, so add a payment method in Voyage, or check the Atlas **AI Model APIs → Model API Keys** page.
- **Track choice:** the README still says Track 1; update it if the team switches.

# agent-tools (Go)

The Go tool service behind Recall.IQ's ElevenLabs voice agent. The voice agent talks and reasons
(choose an OpenAI model for its LLM in ElevenLabs); whenever it needs client memory it calls these
webhook tools, which read and write MongoDB Atlas.

```
Advisor ── voice ──► ElevenLabs agent (LLM: OpenAI)
                          │  webhook tools, header X-Session-Token: {{session_token}}
                          ▼
                    agent-tools (Go) ──► MongoDB Atlas
                          │                 users / clients      → identity + authorization
                          │                 memories             → $vectorSearch with the access pre-filter
                          │                 sources / memories   → voice notes saved as *proposed* memories
                          │                 audit_events         → every tool call
                          ▼
                    Recall.IQ (Next.js) /api/internal/agent/run → governed run: lender policy engine,
                                                                    OpenAI planner, validation, tasks
```

## Governance rules the tools enforce

| Rule | Where |
|---|---|
| Who is speaking comes from a token the app signed (30 min), never from the LLM | `auth.go` `verifyToken`, `src/lib/voice-token.ts` |
| Other firm's client → 404; unassigned client → 403 | `auth.go` `authorizeClient` |
| Retrieval pre-filter: firm, client, `active`, unexpired, embedding model, team-or-allowed | `tools.go` `retrievalFilter` (same as `src/lib/policy.ts`) |
| In-code re-check of every hit | `tools.go` `eligible` |
| Voice can only *propose* memories; an advisor confirms them in the dashboard | `tools.go` `proposeMemory` |
| Forgotten memories cannot be re-created by voice (same fingerprint as the app) | `memoryFingerprint` + `forget_tombstones` |
| Every call is audited (who, which tool, which client; no memory text) | `tools.go` `audit` |

## Tools

All are `POST` with a JSON body and these headers:
`X-Session-Token: {{session_token}}` and, if you set `TOOLS_SHARED_SECRET`, `X-Tools-Secret: <secret>`.

| Path | Body | Returns |
|---|---|---|
| `/tools/list_clients` | `{}` | Clients this advisor is assigned to |
| `/tools/search_memory` | `{ "client_id", "query" }` | Up to 10 confirmed, authorized memories |
| `/tools/prepare_follow_ups` | `{ "client_id", "request" }` | Brief, RBC/TD/CIBC lender decisions with pivotal facts, task changes |
| `/tools/propose_memory` | `{ "client_id", "statement", "category", "spoken_note" }` | Proposal id (unconfirmed) |

## Run it

```bash
cd agent-tools
export MONGODB_URI='mongodb+srv://…'          # same cluster as the app
export VOICE_TOKEN_SECRET='…'                  # same value as in the app's .env
export INTERNAL_API_SECRET='…'                 # same value as in the app's .env
export CONTINUITY_URL='http://localhost:3000'  # where the Next.js app runs
# Embeddings must match the app: atlas-auto (default) or voyage with your MongoDB Model API key
# export VOYAGE_API_KEY='…'  VOYAGE_BASE_URL='https://ai.mongodb.com/v1'  EMBEDDING_MODEL='voyage-4-lite'
go run .
```

ElevenLabs must reach the service over HTTPS, so expose it with a tunnel while developing
(for example `ngrok http 8080`) and use that URL in the agent's tools.

Local smoke test without ElevenLabs:

```bash
TOKEN=$(go run . -mint usr_tomas)
curl -s -X POST localhost:8080/tools/search_memory -H "X-Session-Token: $TOKEN" \
  -d '{"client_id":"cli_c3_priya","query":"move-up mortgage affordability"}'
```

`go test ./...` checks token parity with the TypeScript app, fingerprint parity, and the eligibility re-check.

See [elevenlabs-agent.md](elevenlabs-agent.md) for the agent's prompt and tool definitions.

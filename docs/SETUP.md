# Setup: Atlas + OpenAI + Go tools + ElevenLabs

Everything below runs on your laptop. Keys go in `.env` (git-ignored), never in chat or commits.

## 1. Atlas (Cluster0)

1. **Database Access → Add New Database User** (password auth). Save the username and password.
2. **Network Access → Add IP Address → Add current IP address.**
3. **Cluster0 → Connect → Drivers** and copy the `mongodb+srv://…` string. Put your password in it.

## 2. `.env` in the repo root

```bash
cp .env.example .env
```

Fill in:

```
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.iv8m4zu.mongodb.net/?retryWrites=true&w=majority
OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-4.1

# Embeddings: EITHER leave these empty (Atlas auto-embedding does it inside Atlas),
# OR use your MongoDB Model API key:
VOYAGE_API_KEY=<MongoDB Model API key>
VOYAGE_BASE_URL=https://ai.mongodb.com/v1
EMBEDDING_MODEL=voyage-4-lite

ELEVENLABS_AGENT_ID=<from step 5>
VOICE_TOKEN_SECRET=<any long random string>
INTERNAL_API_SECRET=<another long random string>
ALLOW_DEMO_RESET=true
```

Generate the two secrets with `openssl rand -hex 32`.

## 3. Create collections, indexes and load the data

```bash
npm install
npm run atlas:setup   # collections, validation, and the vector index (waits until queryable)
npm run seed          # demo firms + the hackathon dataset (4 clients, 80 notes, facts, 9 lender policies)
npm run dev           # http://localhost:3000
```

`seed` also writes the raw, sanitized dataset to `dataset_profiles`, `dataset_goals` and
`dataset_meeting_notes`. SINs and business numbers are stripped before anything is stored.

If you switch between Atlas auto-embedding and the Model API key, run `atlas:setup` and `seed` again
(each memory records which embedding model produced it, and retrieval never mixes models).

## 4. Go tool service

```bash
cd agent-tools
set -a; source ../.env; set +a
export CONTINUITY_URL=http://localhost:3000
go run .                 # :8080
ngrok http 8080          # in another terminal; copy the https URL
```

## 5. ElevenLabs agent

Follow [agent-tools/elevenlabs-agent.md](../agent-tools/elevenlabs-agent.md): pick an OpenAI model as the
agent's LLM, paste the system prompt, add the four webhook tools pointing at your ngrok URL, then copy
the agent id into `ELEVENLABS_AGENT_ID` and restart `npm run dev`.

## 6. Demo path

1. Header persona → **Tomás Reyes** (Priya's advisor). Client → **Priya Raman**.
2. Workspace → request "Prepare mortgage and business card options" → **Start fresh agent run**.
   *Lender policy checks* shows RBC/TD/CIBC decisions. The RBC business card is **refer**: Tomás only sees
   the score band (700–799) and RBC needs 720.
3. Persona → **Riya Kapoor (Credit Adjudicator)** → same run: RBC is **approve** (she can read the exact score).
   Switch back to Tomás and open Riya's run: those checks are hidden from him.
4. Memory → Priya's *move-up mortgage request* → **Correct**: stressed TDS 0.541 (guaranteed business
   payments counted). Run again: all three mortgages flip to **decline** and the task is revised, citing v1 → v2.
5. Forget the *credit score band* memory: the next run's credit gates become **refer**.
6. Voice: ask the widget about Priya; say a new fact and see it appear as a proposal awaiting confirmation.

## What has and has not been verified

- Verified here: 35 TypeScript tests and the Go tests pass; `npm run build` succeeds; on Cluster0, an
  Atlas auto-embedding vector index built and a filtered `$vectorSearch` returned only the allowed client.
- Not yet run end to end: the app against Cluster0 with your URI, the OpenAI calls with a real key, and the
  ElevenLabs agent calling the Go tools. Those need your keys and run on your machine.

# MongoDB Agents in Context — Toronto Hackathon

Our team's repository for **MongoDB's Agents in Context Toronto Hackathon** 🇨🇦

> **Want to join or contribute?** Read **[CONTRIBUTING.md](CONTRIBUTING.md)** for how to get access, set up locally, and open pull requests.

---

## 📍 Event at a glance

| | |
|---|---|
| **Venue** | The Quay — 100 Queens Quay E, 3rd Floor, Toronto, ON M5E 1V3 |
| **Doors / Kickoff** | Doors open 9:00 AM · Kickoff 10:00 AM |
| **Schedule & rules** | https://cerebralvalley.ai/e/mongodb-toronto-hackathon/details |
| **Discord** | https://discord.gg/cwtbkrw52 (team formation, live updates, support) |
| **Team size** | Up to 4 people |

### ✅ Before the event — every teammate
- [ ] **Get approved on Cerebral Valley before registration closes on Friday.** This applies to *every* teammate, including anyone not yet approved. Approval is how we get partner resources.
- [ ] Join the Discord.
- [ ] Bring a **government-issued photo ID** for check-in.
- [ ] Get access to this repo and finish the local setup in [CONTRIBUTING.md](CONTRIBUTING.md).
- [ ] Create a free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) account.

---

## 🎯 Problem statements

Every project **must** fit one of these three tracks.

1. **Agents You Can Audit.** Build an agent that uses MongoDB Atlas as its identity, policy and audit layer. Every action is tied to an identity, checked against policy before it runs, and recorded so a reviewer can reconstruct what happened afterward.
2. **Memory You Can Govern.** Build an agent that uses MongoDB Atlas and Vector Search to store and retrieve memory that changes what it does on the next run. Include rules for who can read each memory, how long it lives, and how it gets corrected or forgotten.
3. **Finish the Job.** Build an agent that completes a long, multi-step task across several systems. It uses MongoDB Atlas to persist verified task state and Vector Search to retrieve past experience, so it survives crashes and system changes and knows what actually happened.

**Our track:** 1. Agents You Can Audit (see [docs/IDEA.md](docs/IDEA.md))

---

## 💡 Our project

- **Name:** Vault Agent
- **Track:** 1. Agents You Can Audit
- **One-liner:** A personal-finance agent for your chequing, savings, TFSA, RRSP and mortgage that can only touch **your** accounts, inside CRA and lender rules. Every action is checked against policy in Atlas *before* it runs and written to a tamper-evident audit log.
- **How it uses MongoDB Atlas:** identity (`users`, `accounts.owner_ids`), policy (`policies` as versioned docs), audit (`audit_log`, append-only and hash-chained, with `$jsonSchema` validation), multi-doc transactions for transfers, change streams for the live reviewer feed, and `agent_runs.status` as the kill switch.

Full brief, policy table and demo script: **[docs/IDEA.md](docs/IDEA.md)**

### Tech stack
- **Database:** MongoDB Atlas (stretch: Vector Search over audit reasons)
- **Agent / LLM:** Claude (`claude-opus-5-5`) via the Anthropic Python SDK, manual tool-use loop
- **Backend:** Python 3.10+ CLI (`app/`)
- **Frontend:** TBD (CLI first; a small reviewer dashboard if time allows)

### Running it locally
```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # fill in MONGODB_URI + ANTHROPIC_API_KEY
python -m app.seed              # wipe + seed demo data in Atlas
pytest -q                       # policy tests (mongomock, no Atlas needed)
python -m scripts.demo          # scripted judge scenarios, no LLM
python -m app.agent --user alice   # chat with the agent as Alice
python -m app.review watch      # (2nd terminal) live audit feed via change stream
```

### Code map
| File | Role |
|---|---|
| `app/policy.py` | **The pre-action gate.** `authorize(ctx, tool, args)` → ALLOW / DENY / NEEDS_APPROVAL |
| `app/gate.py` | kill-switch check → authorize → audit decision → run tool → audit result |
| `app/tools.py` | tool schemas the model sees + implementations (no tool takes a `user_id`) |
| `app/audit.py` | hash-chained append-only log + `verify_chain()` |
| `app/agent.py` | Claude tool-use loop; each call carries a required `why` that gets logged |
| `app/review.py` | reviewer CLI: watch, replay, verify, denied, approve, halt, rollback |
| `app/seed.py` | demo users/accounts/room/policies, plus a prompt-injection memo |

---

## 👥 Team

| Name | GitHub | Role |
|---|---|---|
| | | |
| | | |
| | | |
| | | |

---

## 📁 Repo layout (planned)

```
.
├── README.md          ← you are here
├── CONTRIBUTING.md    ← how to join and contribute
├── .env.example       ← env vars template (never commit real .env)
├── docs/IDEA.md       ← idea brief, policies, demo script
├── app/               ← agent, policy gate, tools, audit
├── scripts/demo.py    ← scripted demo (no LLM)
└── tests/             ← policy tests
```

## Contact

Event questions go to the organizers via the Discord or the event page above.
# MongoDB-Hack

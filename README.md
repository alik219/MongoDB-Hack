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

**Our track:** 2. Memory You Can Govern.

---

## 💡 Our project

- **Name:** Continuity
- **Track:** 2. Memory You Can Govern
- **One-liner:** An advisor's agent whose client memory is governed: who can read it, how long it lives, how it is corrected or forgotten, and proof that it changed the next decision.
- **How it uses MongoDB Atlas / Vector Search:** memories are versioned documents; retrieval is `$vectorSearch` with a firm/client/status/expiry/access pre-filter (Atlas auto-embedding or Voyage via the MongoDB Model API); lender policies, audit events, tombstones and runs live in Atlas.

### Tech stack
- **Database:** MongoDB Atlas (+ Atlas Vector Search, auto-embedding)
- **Agent / LLM:** OpenAI (structured outputs) for extraction and planning; ElevenLabs voice agent
- **Backend:** Next.js API routes (TypeScript) + Go tool service (`agent-tools/`)
- **Frontend:** Next.js + Tailwind

Setup: [docs/SETUP.md](docs/SETUP.md). Design: [docs/CONTINUITY.md](docs/CONTINUITY.md).

### Running it locally
```bash
git clone <this-repo-url>
cd <repo-folder>
cp .env.example .env   # then fill in your own values
# install + run steps go here once the stack is chosen
```

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
└── ...                ← project code goes here
```

## Contact

Event questions go to the organizers via the Discord or the event page above.
# MongoDB-Hack

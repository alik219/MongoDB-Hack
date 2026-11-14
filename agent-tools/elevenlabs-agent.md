# ElevenLabs agent setup

Create one agent in ElevenLabs (Agents Platform), then copy its agent id into the app's `.env`
as `ELEVENLABS_AGENT_ID`. The app embeds the ElevenLabs widget on the Workspace page and passes
these dynamic variables when a conversation starts: `session_token`, `client_id`, `client_name`,
`advisor_name`.

## Agent settings

- **LLM:** an OpenAI model (for example GPT-4.1) from the agent's LLM dropdown.
- **First message:** `Hi {{advisor_name}}, I'm ready to help with {{client_name}}. What do you need?`
- **System prompt:**

```
You are Continuity, a voice assistant for a financial advisor ({{advisor_name}}).
The advisor is working on client {{client_name}} (client_id {{client_id}}).

What you know about clients comes ONLY from your tools. Never invent client facts.
- To answer a question about the client, call search_memory first.
- To prepare a review, compare lenders (RBC, TD, CIBC), or plan follow-ups, call prepare_follow_ups.
  Its lender decisions are computed by a rules engine; repeat them, never change them.
  If a decision is "refer" because the exact credit score is restricted, say it must go to credit adjudication.
- When the advisor tells you a new fact, call propose_memory with their words as spoken_note.
  Tell them it is saved as a proposal they must confirm in Continuity.
- If a tool says access is denied, the advisor is not assigned to that client; say so and stop.
- You prepare drafts only. You never approve tasks, contact lenders, trade, or move money.
Keep answers short enough to speak: two or three sentences, then offer detail.
```

## Tools (Webhook tools, method POST)

Add each tool with these two request headers:

| Header | Value |
|---|---|
| `X-Session-Token` | dynamic variable `session_token` |
| `X-Tools-Secret` | your `TOOLS_SHARED_SECRET` (store it as an ElevenLabs secret) |

| Name | URL | Description | Body parameters |
|---|---|---|---|
| `search_memory` | `https://<tunnel>/tools/search_memory` | Search the client's confirmed memories. | `client_id` (string, dynamic variable `client_id`), `query` (string, LLM: what to look for) |
| `prepare_follow_ups` | `https://<tunnel>/tools/prepare_follow_ups` | Run the governed agent: lender policy checks and follow-up drafts. Takes up to a minute. | `client_id` (dynamic variable), `request` (string, LLM: the advisor's request in one sentence) |
| `propose_memory` | `https://<tunnel>/tools/propose_memory` | Save a new fact the advisor said as an unconfirmed proposal. | `client_id` (dynamic variable), `statement` (string, LLM: one plain sentence), `category` (enum: goal, constraint, previous_decision, revisit_condition, preference, advisor_commitment, life_event), `spoken_note` (string, LLM: the advisor's words, verbatim) |
| `list_clients` | `https://<tunnel>/tools/list_clients` | List the clients this advisor is assigned to. | none |

Set the `prepare_follow_ups` tool timeout to the maximum the dashboard allows; the run calls OpenAI.

## Try it

1. In Continuity, switch the persona to **Tomás Reyes** and pick **Priya Raman**.
2. Click the voice widget: "What do we know about Priya's move-up home?"
3. "Compare mortgage options at RBC, TD and CIBC."
4. "Note that Priya's guaranteed business payments count toward TDS." → appears under Memory → awaiting confirmation.
5. Switch to **Daniel Osei** (Maya's advisor) and ask about Priya: the tools refuse with 403.

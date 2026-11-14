# Three-minute demo script

Built on the hackathon dataset: firm **Lakeshore Financial (fictional)**, client **Priya Raman** (founder of Lumenwave Software), lead advisor **Tomás Reyes**. All data is synthetic, and the RBC, TD and CIBC policies are simulated.

**Before you start**

- The header chip should read **Live services**. If it says Partly live or Demo mode, click it to see which service is not live.
- The model key must have credit. Without it, runs stop at "Preparing follow-ups" and the chat returns an error.
- Persona: **Tomás Reyes · Lead advisor**. Client: **Priya Raman**.
- If you rehearsed, run `npm run seed` again so Priya's facts are back to their original versions.

## The script

**0:00 · Set the scene (20s).**
"Priya runs a software company and wants a bigger home. Tomás has three years of meeting notes on her. Recall.IQ turns those notes into memories that Tomás controls, and an agent that acts on them." Open **Dataset**: 80 meeting notes, 4 clients and 9 lender policies, stored in MongoDB Atlas.

**0:20 · Memory is proposed, never assumed (25s).**
On Dataset, open Priya's **November 2026** meeting note and click **Extract memories from this document**. Proposals appear, each quoting the note word for word and marked unconfirmed. "Nothing here is a fact until Tomás confirms it. The agent ignores proposals."

**0:45 · A fresh run that reads memory (35s).**
Workspace, with the request *Prepare mortgage options for Priya's move-up home*, then **Start fresh agent run**.

- Walk the stages: access, retrieval, freshness, lender policies, planning, validation, saving.
- **Lender policy checks**: RBC, TD and CIBC all **approve** the mortgage. Each card names the facts it used and which ones were pivotal.
- Open **Technical trace**: the actual `$vectorSearch` query, with firm, client, status, expiry and access in the filter.

**1:20 · Correct one memory (30s).**
Memories, open *"Move-up home: $1.8M price with a $1.15M mortgage… TDS 39.4% on personal debts only"*, then **Correct**.

- Change `mortgage_stressed_tds` from `0.394` to `0.541`.
- Statement: *Move-up home stressed TDS is 54.1% once guaranteed business payments are counted.*
- Reason: *Lenders count the personal guarantee.*

"Priya personally guarantees $268,000 of company debt. The original number left that out." Saving creates **v2** and keeps v1 as history. Back on Workspace, the draft task that relied on v1 is marked **Needs review**.

**1:50 · The next run behaves differently (25s).**
**Start fresh agent run** with the same request. All three lenders now **decline**. "What changed in this run" shows the mortgage task **revised**, citing memory **v2**. "Same request, same agent. One memory changed, so the outcome changed."

**2:15 · Who can read what (30s).**

- Run *Prepare business card options for Priya.* As Tomás, **RBC refers**: he may see only her score band (Good, 700 to 799), and RBC's card needs 720.
- Switch persona to **Riya Kapoor · Credit Adjudicator** and run it again. Riya may read the exact score, so **RBC approves**.
- Switch back to Tomás: the run Riya made hides those checks from him, and the exact score never appears.
- Switch to **Daniel Osei**: Priya is not in his client list at all.

**2:45 · Proof and audit (15s).**
**Compare Runs** shows the same request three ways: no memory, original memory, corrected memory. **Activity Feed** is the audit trail of every confirmation, correction, run and chat answer.

## If you have more time

- **Forget.** As Tomás, forget *"Priya's credit score band is Good (700 to 799)"*, then run *Prepare line of credit options for Priya.* Every lender moves to **refer**, because the agent no longer has a basis for the credit check. Forget wipes the text and embedding of every version and leaves a fingerprint so the same note cannot bring it back. It does not erase the original source document or Atlas backups, and the app says so.
- **Expiry.** Both credit score memories expire on 2027-03-03. Expiry is part of the search filter, so an expired memory stops being retrieved at that moment, with no cleanup job.
- **Ask Recall.IQ.** Use the chat for a free-form question, such as *What should I be careful about with Priya?* Each answer lists the confirmed memories it used.
- **Another client.** As **Daniel Osei** with **Maya Chen**, a student with a Fair score band, the same lender policies give very different results.

## The three questions, in one line each

1. **Leakage:** the access rule is inside the `$vectorSearch` filter and is checked again in code, so another client's or a restricted memory is never a candidate.
2. **Wrong or expired:** corrections create a new version, forget wipes and tombstones, expiry is enforced at query time, and dependent tasks are flagged and then revised.
3. **Proof:** one corrected memory flips three lender decisions and revises a task that cites the new version, and Compare Runs shows it side by side.

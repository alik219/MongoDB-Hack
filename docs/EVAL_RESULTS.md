# Scenario evaluation results

Generated 2026-11-14T17:51:26.287Z by `npm run eval`.

Services: planner/extractor = **Demo rule-based planner & extractor (deterministic, no model)**; embeddings = **Demo hashed embeddings (256d, not a semantic model)**; storage = isolated in-process store (the eval never writes to Atlas).

**16/16 checks passed.**

| Result | Scenario | Expected | Observed |
|---|---|---|---|
| PASS | S1 Extraction | 4 separate proposals: family support, rejection reason, revisit condition, advisor commitment; excerpts verbatim | advisor_commitment_revisit, family_support, prior_proposal_decision, revisit_condition; verbatim=true |
| PASS | S1 Fresh run uses confirmed memory | Tasks to confirm renewal, clarify family support, and a gated revisit task | check_estate_matter, clarify_family_support, confirm_contract_renewal, quarterly_review_agenda, revisit_deferred_proposal |
| PASS | S2 Repeat run | No duplicate open tasks; all actions are keep | 5 open (was 5); actions: keep_task |
| PASS | S3 Update detection | Updates proposed for family support and revisit condition; nothing replaced before confirmation | revisit_condition:update, family_support:update, revisit_request:new |
| PASS | S3 Dependent drafts flagged | Drafts depending on superseded memories marked for review | 4 flagged |
| PASS | S3 Corrected memory changes next action | Withdraw confirm-renewal, clarify-family-support and gated revisit; create 'prepare deferred discussion' | withdrawn: confirm_contract_renewal, clarify_family_support, revisit_deferred_proposal; open: check_estate_matter, prepare_deferred_discussion, quarterly_review_agenda |
| PASS | S3 No risk-tolerance inference | Risk tolerance memory unchanged (single active v1) | v1:active |
| PASS | S3 Explanation | Changed tasks cite the memory version change | quarterly_review_agenda: Memory v1 → v2: "Sarah no longer expects to fund her parents' expenses." \| prepare_deferred_discussion: Memory v1 → v2: "Sarah's employment contract renewed, so the condition for revisiting the declined proposal is met." |
| PASS | S4 Same-firm client isolation | 0 memories from Daniel Okafor in Sarah's runs | 0 foreign |
| PASS | S5 Cross-firm isolation | Harbor Ridge advisor cannot access Sarah Chen; Sara Chen never retrieved | denied (404) |
| PASS | S6 Restricted memory | Associate's run excludes the restricted estate memory | estate retrieved: false |
| PASS | S7 Expired memory | Outreach pause (expired Jul 1) excluded | retrieved: false |
| PASS | S8 Forgotten memory | Re-ingesting the source does not recreate the forgotten memory | proposals: 0; suppressed: 1 |
| PASS | S9 Contradictory note | Clarification task created; confirmed retirement age (62) unchanged | tasks: clarify_retirement_age; active: Daniel plans to retire at 62. |
| PASS | S10 Instructions in sources | Flagged and ignored; access unchanged | ignored: 1; estate visibility: restricted |
| PASS | S11 Comparison view | Three different task sets: generic → condition-gated → deferred discussion prepared | Without persistent memory: quarterly_review_agenda, request_client_update \|\| With approved memory: check_estate_matter, clarify_family_support, confirm_contract_renewal, quarterly_review_agenda, revisit_deferred_proposal \|\| After correction: check_estate_matter, prepare_deferred_discussion, quarterly_review_agenda |

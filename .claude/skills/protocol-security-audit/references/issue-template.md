# Issue Template

Title: `<Scope> audit: <n> sync/security findings (<k> High)`

Draft the consolidated issue after the requested audit coverage and candidate
verification are complete. Each earlier batch updates its local checkpoint,
not a new issue. If the user explicitly requests an interim issue, prefix the
title with `Partial` and identify pending coverage and unverified candidates.
Only the coordinator may publish an issue or comment, under the authorization
rules in `SKILL.md`; a slice auditor never publishes.

Include an **Audit usage receipt** in the body using the shared
[receipt template](../../../../docs/developer/audit-usage-receipts.md#cutoff-and-public-template),
including for zero findings or partial reports. Keep it in the body when
splitting overflow into comments; preserve its run marker on resume.

Write the rest of the body in this order:

1. **Scope.** State the two invariants, the parity definition, the exclusions,
   the no-brick rule, and the audited revision. Pin every `file:line`
   reference to that revision. Include completed, partial, pending, and
   blocked slices/models from the checkpoint; do not present partial coverage
   or unrun checks as a completed clean audit.
   When coverage is partial (slices grouped, skipped, or not audited at full
   depth, or an interim `Partial` issue), add a coverage table with the
   columns `Slice`, `Covered`, and `Not covered at depth`: one row per
   requested slice and model, naming its auditor grouping and unrun checks.
2. **Verification labels.** Define Probed, Verified, and Traced. Say which
   findings, if any, already have a regression test.
3. **Summary table** with the columns `#`, `Finding`, `Dir`, `Sev`, `Status`,
   and `TLA+`.
4. **Findings**, grouped as High, Medium, and Low. Each finding has:
   - its direction and verification label;
   - evidence as `file:line` bullets, one claim per bullet;
   - the precondition, meaning who can trigger it, or "none" for honest
     operation;
   - a numbered step-by-step scenario;
   - the impact;
   - the suggested fix, with its no-brick check;
   - existing TLA+ coverage and check results, recommended model fixes or
     additions, and validation still needed; or the reason the finding is not
     model-shaped and the regression test that should cover it;
   - for a merged finding, its twin instances (other routes, artifact types, or
     documents versus blobs) as separate evidence bullets.
5. **Formal model audit and recommendations.** List the models,
   configurations, negative controls, and production mappings reviewed;
   defects or coverage gaps; and the proposed follow-up changes. List commands
   actually run with their results, state counts, and bounds, or state why
   checks were not run. Separate observed results from proposed validation.
   State that no production or formal-model fixes were implemented during the
   audit; there is no model-change branch to ship.
6. **Checked and looked sound.** List the areas that held up, so the next
   audit knows the coverage.

Keep each finding readable on its own. Use short paragraphs and bullets rather
than long sentences, and cross-reference related findings by number. Reference
prior audit issues so their follow-ups stay traceable.

Create the issue with
`gh issue create --label bug --title "<title>" --body-file <path>`.

GitHub rejects issue bodies over 65,536 characters, and a 30-finding report
exceeds that. Measure the draft first. If it is too long, keep sections 1-4 and
the recommended fix order in the body and post sections 5 and 6 as the first
comment (`gh issue comment <n> --body-file <path>`), with a pointer in the body.
Do not drop evidence to fit.

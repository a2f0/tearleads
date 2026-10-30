# Issue Template

Title: `Protocol efficiency audit: <n> proposals (<k> High impact)`

Draft the consolidated issue after the requested coverage and proposal
verification are complete. Each earlier batch updates its local checkpoint,
not a new issue. If the user explicitly requests an interim issue, prefix the
title with `Partial` and identify pending coverage and unverified proposals.
Only the coordinator may publish an issue or comment; a slice auditor never
publishes.

Write the body in this order:

1. **Scope.** State the three rules (capabilities preserved, encodings fixed,
   greenfield), the waste units, the exclusions, and the audited revision.
   Pin every `file:line` reference to that revision. Include completed,
   partial, pending, and blocked slices from the checkpoint; do not present
   partial coverage as a completed audit.
2. **Baseline.** The inventory counts (routes, API tables, SDK tables,
   mechanisms) and the measured per-scenario request and byte totals with
   the canary each came from and the fixture size. Reproduce the
   per-endpoint table for the scenarios the proposals cite.
3. **Labels.** Define Measured, Traced, and Estimated, and the impact and
   risk tiers.
4. **Summary table** with the columns `#`, `Proposal`, `Slice`, `Impact`,
   `Risk`, `Label`, `Saves`, and `Retires` (tables or mechanism).
5. **Proposals**, grouped as High, Medium, and Low. Each proposal has:
   - its slice, label, impact, and risk;
   - evidence as `file:line` bullets, one claim per bullet, naming the
     verifier, cache miss, or scheduler decision that issues the request or
     the sites that read and write the table;
   - the measured or traced saving, with its source and fixture size;
   - the proposed shape: route, request and response fields, table, or local
     rule, in enough detail to estimate the change;
   - a preserved-by line for each capability it touches;
   - the security findings it touches and why each stays fixed;
   - the docs, canary ceilings, and formal models that change with it;
   - prerequisites among the proposals, by number;
   - twin paths it generalizes to, as separate evidence bullets.
6. **Capability trades.** Proposals that give up a capability, each with the
   capability, what it buys, and the decision needed. Never ranked with the
   preserving proposals.
7. **Recommended order.** A dependency-ordered sequence, with the target
   table counts and the scenario totals expected after each step, marked
   Estimated unless a probe measured the combination.
8. **Checked and found lean.** Areas examined where the cost matched the
   guarantee, so the next audit knows the coverage.
9. **Not measured.** Scenarios, routes, or sizes the audit did not measure
   and why.
10. **Database leads.** Findings that change only query shape, statement
    batching, transaction scope, or indexes, unranked, for
    `database-efficiency-audit`. Put them in the issue even when that audit
    runs at the same time: the other session may have ended before this one
    publishes, so the issue is the hand-off.

Keep each proposal readable on its own. Use short paragraphs and bullets,
and cross-reference related proposals by number. Reference prior efficiency
and security issues so their follow-ups stay traceable. State that nothing
was implemented during the audit.

Create the issue with
`gh issue create --label enhancement --title "<title>" --body-file <path>`;
without `--title` the command prompts and fails in a non-interactive session.

GitHub rejects issue bodies over 65,536 characters. Measure the draft first.
If it is too long, keep sections 1 to 5 and 7 in the body and post sections 6,
8, 9, and 10 as the first comment (`gh issue comment <n> --body-file <path>`),
with a pointer in the body. Do not drop evidence to fit.

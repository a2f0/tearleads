# Issue Template

Title: `Database efficiency audit: <n> proposals (<k> High impact)`

Draft the consolidated issue after the requested coverage and verification
are complete. Earlier batches update the local checkpoint, not a new issue.
If the user explicitly requests an interim issue, prefix the title with
`Partial` and identify pending coverage and unverified proposals. Only the
coordinator publishes.

The repository is public. The body carries normalized SQL, counts, plans,
and index definitions only: no row data, bind values, credentials, role
names, hostnames, or connection strings.

Write the body in this order:

1. **Scope.** The four rules (behavior preserved, dialect parity,
   greenfield, measure before claiming), the units, the exclusions, the
   audited revision, and the PlanetScale snapshot used (capture time,
   deployed revision, data size). Pin every `file:line` to the audited
   revision. Include completed, partial, pending, and blocked slices.
2. **Baseline.** Inventory counts (API tables and indexes per dialect,
   client tables and indexes), the statement baseline per scenario with its
   source and fixture size, and the PlanetScale summary: query patterns,
   total queries and time in the window, the top ten patterns mapped to
   their code, and the recommendation counts by type and lead status
   (live, moved, stale).
3. **Labels.** Define Measured, Observed, Traced, and Estimated, and the
   impact and risk tiers.
4. **Summary table** with the columns `#`, `Proposal`, `Slice`, `Impact`,
   `Risk`, `Label`, `Saves`, and `Dialects`.
5. **Proposals**, grouped as High, Medium, and Low. Each proposal has:
   - its slice, label, impact, risk, and the dialects it touches;
   - evidence as `file:line` bullets, one claim per bullet, naming the
     executor (root database or transaction) and the statements involved;
   - the measured or traced saving, with its source and fixture size, and
     the production frequency when Observed;
   - the proposed statement, query, index, or transaction shape on each
     dialect;
   - how behavior is preserved: results, atomicity, isolation, lock order,
     verification reads, and commit guards it touches;
   - the statement-budget, plan, and concurrency tests, docs, and formal
     models that change with it, and the security findings it touches;
   - prerequisites among the proposals, by number;
   - twin paths it generalizes to.
6. **PlanetScale recommendations.** Each live or moved recommendation with
   its disposition: adopted as proposal `#`, or declined with the reason
   (unique constraint, other dialect, query that needs it).
7. **Protocol leads.** Findings that would change what the protocol stores
   or sends, handed to `protocol-efficiency-audit`, never ranked here.
8. **Recommended order.** A dependency-ordered sequence with the expected
   statement totals after each step, marked Estimated unless measured
   together.
9. **Checked and found lean.** Areas whose cost matched their result.
10. **Not measured.** Scenarios, dialects, or sizes the audit did not
    measure and why.

Keep each proposal readable on its own, cross-reference related proposals
by number, and reference prior efficiency and security issues. State that
nothing was implemented, and that PlanetScale was read through a temporary
read-only role that was deleted.

Create the issue with
`gh issue create --label enhancement --title "<title>" --body-file <path>`;
without `--title` the command prompts and fails in a non-interactive session.

GitHub rejects bodies over 65,536 characters. Measure the draft first. If it
is too long, keep sections 1 to 5 and 8 in the body and post the rest as the
first comment (`gh issue comment <n> --body-file <path>`) with a pointer in
the body. Do not drop evidence to fit.

# Issue Template

Title: `<Scope> audit: <n> sync/security findings (<k> High)`

Write the body in this order:

1. **Scope.** State the two invariants, the parity definition, the exclusions,
   the no-brick rule, and the audited revision. Pin every `file:line`
   reference to that revision.
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
   - the TLA+ result, or the reason the finding is not model-shaped and the
     regression test that should cover it.
5. **Formal model changes.** List the branch, the modules and configurations
   touched, the negative controls added, the commands run with their results,
   and the state counts and bounds.
6. **Checked and looked sound.** List the areas that held up, so the next
   audit knows the coverage.

Keep each finding readable on its own. Use short paragraphs and bullets rather
than long sentences, and cross-reference related findings by number. Reference
prior audit issues so their follow-ups stay traceable.

Create the issue with `gh issue create --label bug --body-file <path>`.

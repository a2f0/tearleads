# De-slopify Ledger

## Summary

- Date: 2026-08-07
- Repository: tearleads
- Baseline commands: targeted tests per issue #2040 chunk
- Baseline status: passing
- Golden outputs captured: existing behavior-focused test suites
- Notes: Repeated, reviewable chunks tracked against issue #2040.

## Entries

### 2026-08-07 - Billing scalar readers

- Status: accepted
- Classification: exact and parametric duplication
- Equivalence claim: scalar acceptance, null fallbacks, timestamps, and provider
  payload projections are unchanged.
- Risk notes: internal JSON parsing helpers; no public API or serialization
  changes.
- Files changed: billing scalar-reader implementations and focused tests.
- Baseline: 19 Stripe tests passed before editing.
- Verification: 39 focused billing tests and `bun run check:affected` pass.
- Delta: 19 production lines removed net, with focused characterization
  coverage added.
- Decision notes: centralize the duplicated readers in `stripeHttp.ts`.

# De-slopify Ledger

## Summary

- Date: 2026-08-07
- Repository: tearleads
- Baseline commands: targeted tests per refactor entry
- Baseline status: passing
- Golden outputs captured: existing behavior-focused test suites

## Entries

### 2026-08-07 - Tracker document family

- Status: accepted
- Classification: parametric duplication
- Equivalence claim: Weight, Blood Pressure, and Env File keep their public
  components, labels, selectors, validation, formatting, row order, sorting,
  edit lifecycle, attribution, and Env File secret handling while sharing the
  repeated tracker shells.
- Risk notes: React hook lifecycle, targeted row editing, and secret display were
  the primary risks. Domain-specific field rendering and validation remain in
  the document-type modules.
- Files changed: tracker document types plus shared tracker document, index,
  read-card, quick-add, row-model, and store helpers.
- Baseline: 102 targeted tests passed before the refactor.
- Verification: TypeScript build and the same 102 targeted tests passed after
  the refactor; broader repository checks run before shipping.
- Delta: 1,065 lines removed from existing family files before accounting for
  the focused shared implementations.
- Decision notes: accepted because each extracted seam represented the same
  lifecycle or rendering envelope with domain behavior supplied explicitly.

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

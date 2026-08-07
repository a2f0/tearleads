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

### 2026-08-07 - Keying projection records

- Status: accepted
- Classification: exact and parametric duplication
- Equivalence claim: manifest and key-record field selection, array copying,
  projection validation, and error construction are unchanged.
- Risk notes: cryptographic serialization and API response projection; shared
  helpers preserve field order and caller-specific error factories.
- Files changed: keying projection readers, access-manifest records, container
  key records, and their workflow consumers.
- Baseline: the full API memory and SQLite matrix passed at `af42d4f6`.
- Verification: two direct mapper tests, TypeScript, and
  `bun run check:affected` pass.
- Delta: 210 production lines removed net.
- Decision notes: expose one canonical mapper per record and bind projection
  readers once through `createProjectionReaders`.

### 2026-08-07 - Document app and file-type factories

- Status: accepted
- Classification: exact and parametric duplication
- Equivalence claim: all fifteen document app exports retain their provider
  inputs, default local ID, initial document kind, read-only behavior, and child
  inputs. The five file-backed projector definitions retain their icons, labels,
  validated structured fields, filename-derived titles, and untitled fallbacks.
- Risk notes: exact optional provider props and the document kind registry were
  the primary risks. Undefined provider inputs remain omitted, and each wrapper
  now shares the same canonical kind constant as its projector and registry
  entry.
- Files changed: document app wrappers, file-backed projector definitions,
  canonical document-kind constants, the registry, and two shared factories.
- Baseline: 297 document-type tests passed before the refactor.
- Verification: the app TypeScript build and 301 document-type tests passed
  after the refactor, including direct characterization of exact optional prop
  omission and shared file projection; broader repository checks run before
  shipping.
- Delta: 248 production lines removed net before this ledger entry.
- Decision notes: accepted because the factories own only the repeated provider
  and projection envelopes while each document type continues to supply its
  domain component, reader, metadata, and title fallback.

### 2026-08-07 - Organization admin transactions

- Status: accepted
- Classification: exact duplication
- Equivalence claim: each migrated workflow still starts one database
  transaction, requires direct organization-admin access before its workflow
  body, uses that transaction for every subsequent query and lock, and
  propagates the same return values and errors.
- Risk notes: authorization order and transaction identity, especially the
  principal-lock sequence in group deletion.
- Files changed: organization mutation access, group deletion, and billing
  workflow callers.
- Baseline: the full API memory and SQLite matrix passed at `4ba6a5d6`.
- Verification: TypeScript, architecture, source-shape, and the full API memory
  and SQLite matrix pass after the refactor.
- Delta: seven duplicated transaction/admin preambles replaced by one helper;
  15 production lines added net because the callback boundary adds explicit
  nesting at each call site.
- Decision notes: centralize only the exact immediate-admin-gate shape in
  `withOrganizationAdminTransaction`; distinct conditional and serialized
  authorization flows remain local.

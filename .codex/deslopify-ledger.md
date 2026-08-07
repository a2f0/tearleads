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

### 2026-08-07 - Base64url cursor codec

- Status: accepted with explicit input hardening
- Classification: parametric duplication
- Equivalence claim: every cursor emitted by either workflow keeps the same
  JSON payload and base64url bytes; valid organization and attribution cursors
  retain their versions, scope checks, stale-cursor behavior, offsets, and
  caller-specific errors.
- Risk notes: cursor compatibility and denial-of-service bounds. Attribution
  cursors now intentionally inherit the organization codec's canonical
  round-trip check and 512-character ceiling, so non-canonical aliases and
  oversized payloads are rejected as invalid.
- Files changed: shared cursor utility and tests, organization read-model and
  document-attribution cursor consumers, and the Shared Utilities subsystem
  registry/docs.
- Baseline: six focused cursor and pagination tests passed at `f40f18a7`.
- Verification: eight focused tests, TypeScript, architecture, source-shape,
  and `bun run check:affected` pass; the affected API matrix reports 998 tests
  passing on both memory and SQLite.
- Delta: 11 duplicated caller lines removed net; the 36-line shared codec adds
  one validation path and 51 lines of direct boundary coverage.
- Decision notes: payload validation remains caller-owned through parser
  callbacks so domain formats and error classes do not leak into the utility.

### 2026-08-07 - Blob-stage access guard

- Status: accepted
- Classification: exact and parametric duplication
- Equivalence claim: each migrated path still loads a stage by id, rejects a
  missing stage with 404, rejects a foreign owner with 403, and rejects an
  expired stage with 409 in the same order, using the caller's error class.
- Risk notes: authorization order, wall-clock expiry, and transaction identity.
  Completion checks and object-store validation remain caller-owned.
- Files changed: the shared blob-stage access helper and its direct test, blob
  mutation prevalidation and persistence, and multipart-stage services.
- Baseline: 21 focused blob-stage tests passed on the memory backend at
  `1ab1c84b`.
- Verification: 22 focused tests, TypeScript, architecture, source-shape, and
  `bun run check:affected` pass; the affected API matrix reports 999 tests
  passing on both memory and SQLite.
- Delta: 20 production lines removed net, with 99 lines of direct access-guard
  characterization coverage added.
- Decision notes: the helper returns the complete stage projection required by
  all three callers while caller-specific completion and storage checks remain
  local.

### 2026-08-07 - Mutation signer public-key loader

- Status: accepted
- Classification: exact and parametric duplication
- Equivalence claim: each migrated path still selects the signing key and its
  fingerprint by user id, rejects a missing user or fingerprint mismatch with
  `Forbidden`/403, and decodes the same stored base64 key bytes.
- Risk notes: signer identity binding and domain error types. Documents,
  Containers, and Blobs continue to construct their own mutation error class.
- Files changed: the shared signer-key loader and direct tests, document,
  container, and blob mutation callers, and the Access Plane & Keying subsystem
  registry/docs.
- Baseline: the full API memory and SQLite matrix passed at `620984c3`.
- Verification: three direct loader tests, TypeScript, architecture,
  source-shape, and `bun run check:affected` pass; the affected API matrix
  reports 1,002 tests passing on both memory and SQLite.
- Delta: five production lines removed net, with 80 lines of direct identity and
  decode characterization coverage added.
- Decision notes: place the cross-domain loader at the keying workflow seam and
  inject only error construction, keeping mutation facades domain-owned.

### 2026-08-07 - SQL row-update lock helper

- Status: accepted
- Classification: exact and parametric duplication
- Equivalence claim: every migrated query still executes unchanged on SQLite
  and applies the same no-option `FOR UPDATE` lock before execution on
  PostgreSQL; result rows and caller-owned missing-row handling are unchanged.
- Risk notes: query-builder thenable behavior, database dialect selection, and
  transaction lock timing. Table-scoped `FOR UPDATE { of: ... }` and `FOR SHARE`
  paths remain local because their lock semantics differ.
- Files changed: the SQL dialect helper and direct test, three document audit
  writers, and seven Billing, Blobs, and Organizations workflow lock sites.
- Baseline: the full API memory and SQLite matrix passed at `ef663ef9`.
- Verification: the direct dialect test, TypeScript, architecture,
  source-shape, and `bun run check:affected` pass; the affected API matrix
  reports 1,003 tests passing on both memory and SQLite.
- Delta: four production lines removed net, with one direct dialect-branch test
  added.
- Decision notes: accept a structurally typed thenable query so the helper
  preserves Drizzle result inference without depending on a concrete dialect
  query-builder class.

### 2026-08-07 - Session data schema

- Status: accepted
- Classification: handwritten validation replaced by declarative schema
- Equivalence claim: the predicate retains its boolean/type-guard API and the
  same plain-object, lowercase hex, UUID v4, safe timestamp, nonempty IP list,
  nullable last-active IP, and extra-field acceptance rules.
- Risk notes: persisted session parsing and bearer authentication. The schema
  keeps the existing plain-object precondition and exact utility predicates,
  including the array `every` semantics used by stored JSON sessions.
- Files changed: API session validation and direct tests, plus the API package's
  explicit Zod production dependency and lockfile entry.
- Baseline: two direct characterization tests passed against the handwritten
  guard at `273c79cb`.
- Verification: the same two tests, TypeScript, architecture, source-shape,
  production/all-source Knip, and `bun run check:affected` pass; the affected
  API matrix reports 1,005 tests passing on both memory and SQLite.
- Delta: ten validation-source lines removed net, with 40 lines of direct
  boundary characterization coverage added.
- Decision notes: infer `SessionData` from the schema so the runtime validator
  and TypeScript contract cannot drift independently.

### 2026-08-07 - Container-list limit normalization

- Status: accepted
- Classification: redundant boundary coercion and schema/output drift
- Equivalence claim: container-document routes accept and reject the same
  numeric and digit-string limits, emit the same OpenAPI integer contract, and
  pass the same numeric limit to the service; the shared query schema now owns
  the string-to-number conversion.
- Risk notes: request parsing and OpenAPI projection. Registered transforms
  project only their explicitly declared input schema, and their input side is
  still checked for forbidden coercion or normalization.
- Files changed: validator JSON Schema projection and direct tests, the
  container-read operation schema, and its API route consumer.
- Baseline: the existing four validator tests passed at `f9684d85`; that base's
  affected API matrix reported 1,005 passing tests on both database backends.
- Verification: focused validator/OpenAPI and route tests, TypeScript, Biome,
  source-shape, and OpenAPI generation/compatibility checks pass;
  `bun run check:affected` also passes all 15 unit-test tasks and 38 web E2E
  tests.
- Delta: one route-local coercion removed; 13 production lines added net to
  make registered input-transform projection explicit and fail closed.
- Decision notes: retain the query schema's plain-object requirement while
  returning Zod's parsed object, so its inferred numeric limit matches runtime.

### 2026-08-07 - Window chrome-item registration

- Status: accepted
- Classification: exact and parametric duplication
- Equivalence claim: file/view menu items, refresh items, title-bar actions,
  and back actions retain stable registration identities, latest-callback
  dispatch, default values, ordering, disabled behavior, and unmount cleanup.
- Risk notes: callback freshness and registration cleanup. The refresh-only
  disabled unregister was redundant with the prior effect cleanup and removed;
  disabling one registration still cannot clear another registration.
- Files changed: window menu and chrome action hooks, the item registry, and a
  shared registration hook with direct characterization coverage.
- Baseline: 62 window-component tests passed before the refactor.
- Verification: the app TypeScript build and 64 window-component tests pass,
  including direct coverage for stable identity, latest-action dispatch, and
  field-change re-registration and disabled cleanup.
- Delta: 57 production lines removed net before this ledger entry.
- Decision notes: normalize each item shape at its owning boundary while the
  shared hook owns only ref plumbing, commit-time shallow comparison, and
  effects.

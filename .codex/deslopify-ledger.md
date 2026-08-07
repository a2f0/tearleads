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

### 2026-08-07 - Canonical API string-set ordering

- Status: accepted
- Classification: exact and comparator-sensitive duplication
- Equivalence claim: one API utility replaces four local helpers and 26 inline
  string deduplicate/sort expressions. Default JavaScript sorting and the
  existing canonical comparator both use UTF-16 code-unit order; the one
  locale-based helper only receives normalized UUIDs, fingerprints, update
  ids, and protocol hashes, whose established order is unchanged.
- Risk notes: signed manifest inputs, dependency hashes, database lock order,
  and deterministic response projections. Numeric epoch sorting remains local
  and unchanged.
- Files changed: the API array utility and direct test plus its Access,
  Services, Routes, and Workflows consumers.
- Baseline: the canonical identifier characterization test passed against the
  locale-based helper at `da397991`; that base's affected suite passed all 15
  unit-test tasks and 38 web E2E tests.
- Verification: the direct helper and five lock/manifest-focused test files,
  TypeScript, Biome, architecture, source-shape, and `bun run check:affected`
  pass; the affected API matrix reports 1,007 tests passing on both memory and
  SQLite.
- Delta: three production lines removed net, with 29 lines of direct comparator
  characterization added.
- Decision notes: canonicalize on the existing explicit `compareStrings`
  code-unit comparator, matching crypto's canonical ordering and JavaScript's
  default string sort without depending on host locale.

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

### 2026-08-07 - Realtime subsystem relocation

- Status: accepted
- Classification: cohesive subsystem scattered across the API source root
- Equivalence claim: the realtime gateway, socket routing, interest store,
  ticket identity and issuance, and session-revocation behavior are unchanged;
  only module locations and the imports that name them changed.
- Risk notes: API process composition, WebSocket upgrade authentication,
  Redis pub/sub routing, and session revocation. Colocated tests moved with
  their implementations, while `sessionRevocation.ts` remains assigned to the
  Session Lifecycle subsystem despite its physical realtime location.
- Files changed: eight API realtime production modules and ten colocated tests
  moved under `src/realtime/`, with import consumers, subsystem documentation,
  the subsystem registry, and the source-shape path baseline updated.
- Baseline: 59 realtime and composition-root tests passed at `4eb574dc` before
  the relocation.
- Verification: 61 focused realtime, composition-root, and ticket-route tests,
  TypeScript, Biome, architecture, source-shape, Knip, protocol models, and
  `bun run check:affected` pass; the affected suite includes the full API
  memory/SQLite matrix and 38 web E2E tests.
- Delta: no production logic changed and no new runtime abstraction or export
  was introduced.
- Decision notes: keep the eight production modules and their tests flat in
  `src/realtime/`; retain exact per-file subsystem mappings so physical
  cohesion does not conflate Realtime Sync with Session Lifecycle ownership.

### 2026-08-07 - Org Manager operation envelopes

- Status: accepted
- Classification: exact async control-flow duplication and vocabulary drift
- Equivalence claim: the six scoped refreshers and seven organization
  mutations retain their availability guards, request/operation freshness,
  loading and mutating transitions, error clearing and reporting, settled
  marks, result application, and mutation-specific follow-up sequencing.
- Risk notes: organization switches, stale responses, and abandoned mutations.
  The shared runners continue to suppress every stale completion and leave a
  stale scope's busy state untouched; per-call loading and error policies stay
  explicit at each refresher.
- Files changed: Org Manager refresh and mutation hooks, two shared lifecycle
  runners with direct tests, the request/settlement resource vocabulary, and
  the obsolete refresher file-size baseline.
- Baseline: 395 Org Manager tests passed at `0d04f4c2`.
- Verification: app TypeScript, Biome, architecture, file-layout,
  source-shape, protocol, dependency, and `bun run check:affected` checks pass;
  the focused Org Manager suite reports 399 tests passing, the affected app
  suite reports 2,249 passing and one skipped, and all 38 web E2E tests pass.
- Delta: 17 production lines removed net, with 160 lines of direct lifecycle
  coverage added.
- Decision notes: use one canonical `organizationPolicyHistory` resource name;
  represent an unavailable refresh with a null loader so an invalid identifier
  cannot reach its data action; keep domain-specific result handling inside
  each hook.

### 2026-08-07 - Provider pass-through surfaces

- Status: accepted
- Classification: exact facade and snapshot projection duplication
- Equivalence claim: Org Manager, document, explorer, and contacts consumers
  retain the same SDK actions, snapshot fields, write gates, filtered explorer
  nodes, behavioral helpers, enumerable public surfaces, and memoized function
  identities without exposing store lifecycle or maintenance methods.
- Risk notes: organization actions are prototype methods that require their SDK
  receiver; their projection binds them once per SDK facade. Plain store actions
  retain their original function references. Document read-only gates and the
  explorer's visible-node and Trash projections still override snapshot values
  explicitly.
- Files changed: the four app store providers, shared facade projection,
  focused consumer types and fakes, direct hook-level surface tests, and the
  obsolete Org Manager provider source-shape suppression.
- Baseline: 581 focused Org Manager, document, explorer, and contacts tests
  passed at `d8816129`.
- Verification: app TypeScript, the 587-test focused matrix, Biome,
  source-shape, package assertions, Knip, architecture, protocol, OpenAPI, file,
  binary, Ruby, shell, and Markdown checks pass; `bun run check:affected`
  reports 2,255 app tests passing with one skip and all 38 web E2E tests passing.
- Delta: eight production lines removed net, with 407 lines of direct surface,
  receiver, identity, write-gate, and node-projection characterization coverage
  added.
- Decision notes: retain Org Manager's narrow action contract and positional
  membership adapters while projecting its remaining SDK actions. Type-exhaustive
  public-key lists prevent provider and store surfaces from drifting:
  organization class methods are bound into an enumerable object, plain-store
  functions are copied by identity, and complete snapshot contracts are spread
  directly.

### 2026-08-07 - Explorer upload picker

- Status: accepted
- Classification: exact React ref, file-input, and change-handler duplication
- Equivalence claim: toolbar and context-menu uploads still open a hidden,
  multi-file picker, capture the selected target container before the picker
  opens, pass the same files to `startImport`, clear the picker value after each
  selection, and discard the captured target after both populated and empty
  changes. The intentional DOM change is that Explorer mounts one shared picker
  instead of two identical hidden inputs.
- Risk notes: file-input ref lifetime and stale container targets. The surviving
  hook remains mounted at the Explorer root, and direct coverage proves a change
  without a new trigger cannot reuse the prior target.
- Files changed: Explorer composition, its context-menu layer and harness, and
  the toolbar upload hook with direct characterization coverage.
- Baseline: 18 context-menu and toolbar tests passed at `b3c84651` before the
  refactor.
- Verification: app TypeScript and Biome pass; all 489 Explorer tests pass,
  including the attachment request-volume flow through the context-menu action.
  Broader repository checks run before shipping.
- Delta: 33 production lines removed net and one redundant hidden DOM input
  eliminated; direct picker lifecycle coverage added.
- Decision notes: keep file selection and target cleanup in
  `useExplorerToolbarUpload`; the context-menu layer now owns only action
  visibility and delegates the target container to the shared trigger.

### 2026-08-07 - Shared sidebar resizing

- Status: accepted
- Classification: parametric React event, sizing, accessibility, and CSS
  duplication
- Equivalence claim: windowed and routed tablet sidebars retain their respective
  160px and measured/CSS-backed 224px defaults, 80–400px bounds, 10px keyboard
  steps, Shift multiplier, Home/End behavior, separator semantics, variant handle
  geometry, and document-body cursor/selection cleanup. The intentional input
  change is that the windowed sidebar now uses the routed sidebar's primary
  pointer-event model, adding touch support and ignoring non-primary drags.
- Risk notes: pointer ownership, drag cancellation, unmount cleanup, and the
  routed sidebar's initially measured width. The shared hook keeps width nullable
  when CSS owns the initial routed width and filters move/end events by pointer
  id.
- Files changed: shared sidebar resize hook, handle, and chrome CSS plus the
  windowed and routed sidebar consumers and windowed pointer characterization.
- Baseline: five focused windowed/routed sidebar tests passed at `10db7954`.
- Verification: app TypeScript, Biome, architecture, source-shape, six focused
  sidebar tests, and all 92 window/routed-layout tests pass. The affected suite
  reports 2,257 app tests passing with one skip; 35 of 38 web E2E tests passed in
  its first run, and the three concurrent app-shell startup timeouts passed 3/3
  on an immediate isolated retry.
- Delta: 71 production lines removed net while consolidating both event
  lifecycles and the common handle chrome; pointer bounds and cleanup coverage
  added.
- Decision notes: keep layout-specific width defaults, DOM wrappers, and narrow
  versus touch-sized handle geometry local; share only the sizing lifecycle,
  ARIA contract, pointer listeners, keyboard behavior, and common chrome.

### 2026-08-07 - Stable crypto session context

- Status: accepted
- Classification: React context identity churn and redundant authentication
  wrappers
- Equivalence claim: `login` still returns false without a signing key and
  otherwise calls SDK login without a challenge; `loginWithChallenge` passes its
  challenge unchanged; logout and every session setter retain their SDK targets.
  The intentional identity change is that both login properties now reference
  the same stable optional-challenge callback, and an unchanged exposed session
  snapshot retains the same context object across provider-only renders.
- Risk notes: over-memoization could hide SDK session updates, and collapsing the
  login wrappers could change their call shapes. Direct provider coverage proves
  that an exposed snapshot change publishes a new value, both login forms retain
  their arguments/results, missing keys still fail closed, and logout delegates.
- Files changed: `CryptoSessionProvider` and direct context/action identity
  characterization coverage.
- Baseline: 16 focused crypto-session, authentication, and identity-autopilot
  tests passed at `fc87f765` before the refactor.
- Verification: app TypeScript, Biome, architecture, source-shape, 19 focused
  crypto/identity tests, and all 212 provider tests pass. The affected suite
  reports 2,258 app tests passing with one skip and all 38 web E2E tests passing;
  every static, OpenAPI, and protocol-model gate passes.
- Delta: one per-render login closure and two wrapper identities eliminated; the
  explicit memo dependency contract adds 27 production lines net, with direct
  stable-versus-changing context coverage added.
- Decision notes: retain the two public login property names for compatibility,
  but back them with one optional-challenge implementation. Memoize only the
  exposed context fields so private persistence state cannot trigger consumers.

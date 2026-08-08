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
  Both login properties now retain stable identities, and an unchanged exposed
  session snapshot retains the same context object across provider-only renders.
- Risk notes: over-memoization could hide SDK session updates, and collapsing the
  login wrappers could change their call shapes. Direct provider coverage proves
  that an exposed snapshot change publishes a new value, both login forms retain
  their arguments/results, incidental login arguments remain ignored, missing
  keys still fail closed, and logout delegates.
- Files changed: `CryptoSessionProvider` and direct context/action identity
  characterization coverage.
- Baseline: 16 focused crypto-session, authentication, and identity-autopilot
  tests passed at `fc87f765` before the refactor.
- Verification: app TypeScript, Biome, architecture, source-shape, 19 focused
  crypto/identity tests, and all 212 provider tests pass. The affected suite
  reports 2,258 app tests passing with one skip and all 38 web E2E tests passing;
  every static, OpenAPI, and protocol-model gate passes.
- Delta: one per-render login closure and the challenge wrapper eliminated; the
  explicit memo dependency contract adds 28 production lines net, with direct
  stable-versus-changing context coverage added.
- Decision notes: retain the two public login property names for compatibility,
  with a stable zero-argument login wrapper that preserves incidental-argument
  behavior and the optional-challenge implementation used directly for
  `loginWithChallenge`. Memoize only the exposed context fields so private
  persistence state cannot trigger consumers.

### 2026-08-07 - Content-key store variants

- Status: accepted
- Classification: structurally duplicated persistence orchestration
- Equivalence claim: document and blob bundle reads, first-writer conflict
  handling, current-target validation, metadata refreshes, target
  reconciliation, projections, and write-header idempotency retain their exact
  stored rows, return values, error classes, messages, statuses, and document
  sync error codes.
- Risk notes: same-epoch races, stale document projections, additive document
  targets, blob target replacement without byte replacement, content-key epoch
  gates, and reused write-header record domains.
- Files changed: the document and blob content-key stores now configure one
  shared typed store core; the obsolete blob store file-size baseline was
  removed.
- Baseline: the API memory and SQLite matrices each passed 1,010 tests with
  three expected skips at `8a5c00ed` before the store-core extraction.
- Verification: TypeScript, Biome, OpenAPI and protocol checks, Knip,
  architecture, source-shape, Markdown, and `bun run check:affected` pass; the
  affected API matrix again reports 1,010 passes and three expected skips on
  each database engine.
- Delta: the two domain variants shrink by 188 production lines combined, the
  blob variant returns under the default source-shape budget, and the shared
  426-line core replaces the paired algorithms with one implementation and
  explicit domain adapters.
- Decision notes: preserve document-only link-set metadata and additive target
  growth, preserve blob-only target replacement and fixed content-key epoch
  rules, and keep table-specific Drizzle operations in the variants. The core
  owns only behavior shared by both stores.

### 2026-08-07 - Database workflow service facades

- Status: accepted
- Classification: repeated route-facing runtime-to-database adapter
- Equivalence claim: the converted container, document, and principal services
  remain async two-argument functions, pass the identical `runtime.db` and input
  object to the same workflow, and preserve workflow results and rejections.
- Risk notes: exported declaration inference, async promise adoption, workflow
  test-only optional parameters, and the route/service/workflow dependency
  direction. Private workflow input types retain explicit service-facing shapes.
- Files changed: side-effect-free `services/databaseWorkflowService.ts`, eight
  database-only service facades, architecture docs/registry, and direct adapter
  coverage.
- Baseline: immediately preceding API memory and SQLite matrices each passed
  1,010 tests with three expected skips at `bf75fd98`.
- Verification: TypeScript, Biome, OpenAPI and protocol checks, Knip,
  architecture, source-shape, Markdown, and `bun run check:affected` pass; the
  API memory and SQLite matrices each report 1,011 passes and three expected
  skips, including the direct adapter test.
- Delta: 21 production lines removed net across the service layer while eleven
  repeated async wrappers now use one typed adapter.
- Decision notes: retain the enforced route -> service -> workflow boundary.
  Database-only service facades select `runtime.db`; routes do not import
  workflows or select infrastructure. Keep the non-async delete facade and the
  optional-input trial-expiry worker seam explicit because their call contracts
  differ from the shared async two-argument shape.

### 2026-08-07 - Shared asynchronous system-container derivation

- Status: accepted
- Classification: duplicated React async-to-state lifecycle and redundant
  per-consumer key derivation
- Equivalence claim: user and organization system slots retain their initial
  empty values, keep the prior non-empty projection while a replacement source
  settles, reset after a missing source or active-source rejection, ignore stale
  and unmounted results, and report the existing bootstrap and built-in Explorer
  error labels. Bootstrap, Explorer, Contacts, and document Trash receive the
  same user-container definitions and slots as before.
- Risk notes: signing-key transitions, late promise settlement, provider order,
  and sharing one derived array across consumers. Direct hook and provider
  coverage proves stale-result suppression, reset/error behavior, retained state
  during replacement, shared array identity, and exactly one derivation per key.
- Files changed: shared async-derived-state hook, runtime-level user-system-
  containers provider, app provider composition, and the bootstrap, Explorer,
  Contacts, document-Trash, and built-in-slot consumers.
- Baseline: 48 focused system-container, bootstrap, Explorer, and Contacts tests
  passed at `081e5f74` before the refactor.
- Verification: app TypeScript, four direct hook/provider tests, and all 135
  bootstrap, Explorer-store, Contacts-store, and shared document-Trash tests
  pass. `bun run check:affected` passes every static, architecture, OpenAPI, and
  protocol-model gate; 2,262 app tests pass with one skip, and all 38 web E2E
  tests pass.
- Delta: 66 production lines removed net; three independent user-slot effects
  become one runtime derivation shared by every consumer, and the remaining
  organization-slot effect uses the common lifecycle. Direct lifecycle and
  fan-out characterization coverage added.
- Decision notes: derive user containers above the device-first/bootstrap stack
  because the signing key is runtime-scoped, then expose a strict context to all
  nested consumers. Preserve the bootstrap error label as the canonical failure
  signal while eliminating duplicate Explorer/Contacts derivations and duplicate
  error reports. Keep built-in organization slots local to Explorer because they
  are feature-flagged presentation state rather than identity-wide runtime state.

### 2026-08-07 - Direct system-container ID resolution

- Status: accepted
- Classification: exact forwarding aliases
- Equivalence claim: Explorer Trash, Contacts, primary-organization Contacts,
  and delete-target lookups pass the same node arrays, derived slots,
  organization ids, and active-root ids to `getExplorerSystemContainerId`, so
  null handling and active-root-before-organization precedence are unchanged.
- Risk notes: the aliases carried domain-specific names that could conceal a
  call-shape difference. The implementation signatures were identical, and the
  retained characterization matrix covers null inputs, slot matching,
  same-slot multi-organization selection, active-root convergence, Contacts
  projection, and own/foreign Trash deletion.
- Files changed: Explorer system-container resolution/provider and tests,
  Contacts provider/projection-root module and tests, and the primary-system-
  containers hook.
- Baseline: 23 focused Explorer, Contacts, multi-organization, and primary-
  system-container tests passed at `0a711d6a` before the refactor.
- Verification: app TypeScript, Biome, and the same 23 focused tests pass.
  `bun run check:affected` passes every static gate, 2,262 app tests with one
  intentional skip, and all 38 web end-to-end tests.
- Delta: 50 production lines removed net; the two Trash aliases and Contacts
  alias are deleted, and every production caller now names the single resolver.
  Two assertions that only repeated the base resolver's null checks through a
  deleted alias were removed; all behavioral cases remain.
- Decision notes: keep `getExplorerSystemContainerId` as the one typed lookup
  seam because its generic node shape already supports both full Explorer nodes
  and narrow Contacts projection nodes. Retain domain-specific policy in callers
  rather than encoding names in no-op wrappers.

### 2026-08-07 - Runtime-scoped SDK handle memoization

- Status: accepted
- Classification: duplicated React memo invalidation policy
- Equivalence claim: six SDK handles whose prior dependencies included the
  whole runtime snapshot still rotate on the same render-consistent Runtime
  Context value and on every explicit input change. The Explorer document-link
  workflow now also rotates for runtime-version changes that reuse every public
  slice, matching the SDK handle's runtime-scoped contract.
- Risk notes: callback identity drives downstream reload effects. The three
  document-query handles, blob loader, and container-info loader retain their
  narrower database/scope or runtime-slice lifetimes so server events cannot
  bypass write-queue throttles or cause loading flicker. Direct hook coverage
  proves stable identity across unrelated renders and replacement on a
  billing-gate-only transition, an event transition, or explicit input change;
  Explorer projection coverage proves a rotated priming callback neither
  re-primes unchanged summaries nor fires a destructive link refresh.
- Files changed: shared SDK memo hook and test, a dynamically discovered Biome
  custom-hook check; device-first, Documents, Contacts, and Explorer
  document-link consumers; and comments pinning the intentionally narrow query
  lifetimes.
- Baseline: seven provider and store-context tests passed at `d47fa075` before
  the refactor.
- Verification: the baseline tests plus the new runtime-scoped memo lifecycle
  test pass, and app TypeScript passes. `bun run check:affected` passes every
  static, architecture, OpenAPI, and bounded protocol-model gate; 2,264 app
  tests pass with one intentional skip, and all 38 web end-to-end tests pass.
- Delta: ten production lines removed net; seven runtime-bound SDK handles now
  share one invalidation hook, and the Explorer call chain no longer threads a
  full runtime snapshot solely to invalidate a memoized handle.
- Decision notes: retain explicit dependency arrays for non-runtime inputs and
  SDK instance/facade replacement. Use the Runtime Context object that
  `TearleadsProvider` rebuilds from `tearleads.runtime.version`, keeping the
  memo key consistent with the runtime snapshot rendered by each consumer.
  Preserve narrower memoization where callback identity owns an immediate or
  user-visible reload side effect. Discover every source file referencing the
  shared hook and run a dedicated Biome exhaustive-dependency pass, so future
  callers are covered automatically without enabling 34 unrelated legacy-hook
  diagnostics across the app. That pass reports missing dependencies but not
  unnecessary ones because intentional invalidation-only keys are part of this
  hook's contract; the wrapper injects the implicit runtime key while callers
  declare every value captured by their factory.

### 2026-08-07 - Shared component context-menu state

- Status: accepted
- Classification: parametric React state duplication and dead internal export
- Equivalence claim: the pane launcher, taskbar window menu, window title-bar
  menu, and table column menu retain their prior pointer or anchor coordinates,
  event cancellation and propagation behavior, action-before-close ordering,
  rendered items, and close behavior. Target-bearing consumers of
  `useContextMenuState` retain their required id argument and `onOpen` timing.
- Risk notes: the four triggers deliberately use three different event
  contracts, and the column menu anchors below its button rather than at the
  pointer. The shared hook therefore accepts an already-derived position; each
  component keeps its original event handler and derives the same coordinates.
  A dedicated position-state hook keeps target-bearing consumers' required id
  argument unchanged.
- Files changed: shared context-menu state hook and coverage; pane footer,
  taskbar window button, window title bar, and table column-menu consumers; and
  the routed pane module/test that solely exposed and exercised the dead
  `menuPositionBelow` helper.
- Baseline: 30 focused shared-menu, footer, title-bar, column-menu, and routed-
  pane tests passed at `78f3afe2` before the refactor.
- Verification: the corresponding focused suite passes 29 tests with 73
  expectations after the refactor. `bun run check:affected` passes every
  static, architecture, OpenAPI, and bounded protocol-model gate; 2,263 app
  tests pass with one intentional skip, and all 38 web end-to-end tests pass.
- Delta: four independent context-menu state/open/close lifecycles now use one
  hook, and the six-line test-only production export plus 33 lines of tests and
  fixture code are deleted. The production diff adds three lines net to make the
  shared hook support targetless menus and caller-derived positions explicitly.
- Decision notes: preserve local event handling instead of forcing every menu
  through the hook's right-click policy; that avoids changing click bubbling or
  moving the column dropdown from its button edge to the pointer. Keep the pane
  desktop menu and sync-status popover local because they are not among the four
  duplicated component triples in this candidate and have different surface
  behavior.

### 2026-08-07 - Split window-state test consumers

- Status: accepted
- Classification: test-only production facade over deliberately split contexts
- Equivalence claim: each former consumer reads or invokes the same state and
  action context values as before. Tests that need both retain both subscriptions;
  production consumers and provider nesting are unchanged.
- Risk notes: the merged hook subscribed callers to state updates while exposing
  stable actions. Tests that need both still subscribe to both contexts; tests
  that only need one side now state that dependency directly. The provider's
  action-only no-rerender characterization remains intact.
- Files changed: WindowStateProvider exports, context documentation, test
  utilities and provider coverage, plus three window integration harnesses.
- Baseline: 28 focused window provider, menu, context-menu, and window tests
  passed at `51eb7e93` before the refactor.
- Verification: the same 28 focused tests pass with 100 expectations.
  `bun run check:affected` passes TypeScript and every static, architecture,
  OpenAPI, and bounded protocol-model gate; 2,263 app tests pass with one
  intentional skip, deployment-package tests pass, and all 38 web end-to-end
  tests pass.
- Delta: the 16-line merged production hook and its export are deleted. Test
  harnesses name state and actions separately, so the package no longer carries
  a production API solely for test convenience.
- Decision notes: retain the split contexts and their separate hooks as the
  canonical seam. Keep a small labeled `{ state, actions }` harness only inside
  provider tests rather than rebuilding a flattened combined context value.
  Stage the deletion before the architecture check because that check derives
  tracked TypeScript files from the Git index and otherwise treats a worktree-
  deleted file as uncovered.

### 2026-08-07 - Org-manager refresh topology

- Status: accepted
- Classification: scattered refresh topology, ambiguous effect naming, and an
  internal barrel
- Equivalence claim: refresh callback bodies, arguments, dependency arrays,
  loading/error transitions, and invocation order are unchanged. Production
  changes are file paths, exported hook identifiers, and a shorter equivalent
  ordering comment; direct imports replace the org-switcher barrel without
  altering its controller or scope behavior.
- Risk notes: hook path and identifier changes can break reachability, while
  refresh effects are sensitive to entry, re-entry, scope, and stale-request
  behavior. Focused coverage characterizes each of those transitions, visible-
  data dispatch, directory settlement, and organization-switcher races.
- Files changed: org-manager refreshers, organization, billing, grants, groups,
  and hook modules and tests; the org-manager directory-name policy; and the
  relocated source-shape baseline key.
- Baseline: 51 focused org-manager refresh and organization-switcher tests
  passed with 186 expectations at `9b26867a` before the refactor.
- Verification: the same 51 focused tests pass with 186 expectations.
  `bun run check:affected` passes TypeScript and every static, architecture,
  OpenAPI, and bounded protocol-model gate; 2,263 app tests pass with one
  intentional skip, deployment-package tests pass, and all 38 web end-to-end
  tests pass.
- Delta: all callback-producing `*Refresher` hooks now live in the explicit
  root-level refreshers directory; four effect-only hooks use explicit
  `*RefreshEffect` names; two refresh tests and the switcher-controller test are
  adjacent to their implementations; and seven production lines are removed
  net with no suppression growth. The scope-reset ordering invariant is retained
  in a shorter comment that stays within the existing source-shape budget.
- Decision notes: add `refreshers` to the bounded org-manager directory-name
  policy rather than using `organization` as an implicit cross-feature bucket or
  adding prohibited third-level nesting. Transfer the existing aggregator's
  Biome baseline entry to its new path without increasing its allowance, remove
  the switcher barrel, and keep implementation-specific refresh tests beside the
  code they characterize.

### 2026-08-07 - Shared mini-app section navigation

- Status: accepted
- Classification: duplicated menu/sidebar rendering and select-footer
  reconstruction through private styling hooks
- Equivalence claim: organization and identity sections retain the same order,
  labels, icons, click targets, navigation labels, selected-sidebar state, and
  panel registration lifecycle. Organization context-menu routing remains
  optional and target-specific. Switcher footer actions retain the same disabled
  state, label, icon, callback-before-close order, and zero-option openability.
- Risk notes: the shared generic must preserve feature-specific view and context
  target types, while changing the select footer seam must not alter close order
  or focus behavior. Focused coverage characterizes menu navigation, sidebar
  registration and disablement, organization context menus, switcher selection,
  zero-organization behavior, footer actions, loading, errors, and unavailable
  identity state.
- Files changed: the shared mini-app section-navigation component and styles;
  `MiniAppSelectMenu`; and the organization and identity section registries,
  menus, sidebars, switchers, and feature styles.
- Baseline: 19 focused organization/identity menu, sidebar, and switcher tests
  passed with 52 expectations at `c97995fd` before the refactor.
- Verification: the same 19 focused tests pass with 54 expectations. TypeScript
  passes, and `bun run check:affected` passes every static, architecture,
  OpenAPI, and bounded protocol-model gate; 2,263 app tests pass with one
  intentional skip, deployment-package tests pass, and all 38 web end-to-end
  tests pass.
- Delta: the four feature-specific menu/sidebar renderers now use one shared
  renderer and registration hook; two footer render props become a typed action
  owned by `MiniAppSelectMenu`; duplicated feature CSS is removed; and production
  code removes 33 lines net with no new suppressions or baseline growth.
- Decision notes: keep feature wrapper names and section registries as their
  public ownership seams while sharing only their repeated structure. Preserve
  organization context-menu optionality and identity availability behavior, and
  keep the switcher footers independent of `MiniAppSelectMenu`'s private class
  names.

### 2026-08-07 - Shared mini-app route state

- Status: accepted
- Classification: duplicated routed/local state bridge with history-option
  drift
- Equivalence claim: each mini-app still uses its original parser, formatter,
  default or explicit local value, and route-specific actions. Contacts keeps
  its transient-draft replacement policy; Org Manager keeps synchronous route
  and selected-group refs plus invalid-group replacement; Notes keeps its
  prop-driven windowed selection and no-op local route writer. Existing Identity
  Manager calls behave identically, while its setter now accepts and forwards
  the same optional `replace` flag as the other route hooks. System Monitor keeps
  its local default and post-parse visible-tab fallback.
- Risk notes: history push-versus-replace behavior, callback stability, and
  immediate Org Manager refs are observable. The shared generic separately
  types the readable route and writable route so Notes can read `null` without
  allowing callers to navigate to it.
- Files changed: the shared navigation route-state hook and coverage; Contacts,
  Identity Manager, Notes, Org Manager, and System Monitor route consumers; and
  Identity Manager route coverage for the previously dropped replacement option.
- Baseline: 25 focused navigation and mini-app route tests passed with 107
  expectations at `639ba2ae` before the refactor.
- Verification: the original coverage plus the new shared/local and Identity
  Manager option cases passes 29 focused tests with 116 expectations.
  The 12 System Monitor component tests pass with 63 expectations after its
  route bridge joins the shared hook.
  `bun run check:affected` passes TypeScript and every static, architecture,
  OpenAPI, and bounded protocol-model gate; the complete app and affected
  deployment-package test suites pass, and all 38 web end-to-end tests pass.
- Delta: five hand-written routed/local adapters now use one 41-line typed hook.
  Their consumer files remove 35 production lines net; the shared seam makes the
  complete production change six lines larger while removing the five independent
  control-flow copies. No suppressions or source-shape baselines are added.
- Decision notes: keep route parsing, formatting, domain transitions, and route
  resolution in their owning mini-apps. The shared hook owns only host selection,
  local fallback dispatch, and history-option forwarding. Keep Notes' parser
  adapter module-scoped so the shared setter retains its prior stable identity.

### 2026-08-07 - Tracker type-class cleanup

- Status: accepted
- Classification: vestigial per-type CSS hooks and dead shared customization
  props
- Equivalence claim: Weight and Blood Pressure retain the same shared tracker
  chrome, domain grid classes, responsive layouts, controls, validation,
  accessibility labels, row ordering, and count placement. Only class tokens
  with no stylesheet rules or production selectors are removed; the two tests
  that used type-specific footer classes now select the existing shared footer.
- Risk notes: class removal can alter styling or external selectors. Repository-
  wide searches establish that the ten removed type-specific tokens had no CSS
  rules and no production consumers, while focused tests characterize edit/read
  modes, quick-add flows, responsive row structure, and footer placement.
- Files changed: Weight and Blood Pressure tracker shells, quick-adds, read rows,
  count tests, and browser layout coverage; plus the shared tracker document and
  quick-add components.
- Baseline: 41 focused Weight and Blood Pressure tests passed with 164
  expectations at `bae60403` before the cleanup.
- Verification: the same 41 focused tests pass with 164 expectations. The three
  tracker-layout browser scenarios pass after moving their vestigial read-row
  locators to the shared tracker class. `bun run check:affected` passes
  TypeScript and every static, architecture, OpenAPI, and bounded protocol-model
  gate; 2,267 app tests pass with one intentional skip, all affected deployment-
  package tests pass, and all 38 web end-to-end tests pass.
- Delta: ten unused type-specific class tokens and four customization props are
  removed. Production code removes 27 lines net, including the now-unused
  `classNames` import in the shared document shell, with no behavior branches,
  suppressions, or source-shape baseline growth.
- Decision notes: retain the Weight and Blood Pressure grid-area classes because
  their styles are domain-specific. Retain `TrackerReadCard.className` because
  Env File uses that supported seam for its two-cell read-row layout; remove only
  the unexercised shared tracker props whose sole callers supplied dead tokens.

### 2026-08-07 - Union-driven app feature flags

- Status: accepted
- Classification: duplicated flag-specific provider state, context fallbacks,
  and System Monitor rendering
- Equivalence claim: every feature retains its storage key, disabled default,
  enabled/disabled persistence modes, consumer gate, System Monitor label,
  switch label, and display order. Consumers outside a provider still observe
  every flag as disabled and mutations remain no-ops; nested providers still
  reuse the outer persistent value.
- Risk notes: collapsing five React state cells into one set can affect context
  identity and nested-provider detection. The generic setter preserves the prior
  synchronous persistence and no-op repeated-state behavior, while focused tests
  directly characterize the unprovided fallback, nested identity, persisted
  initialization, updates, and every consumer-facing toggle.
- Files changed: the app feature-flag ID registry, persistence tests, provider
  and new provider coverage; Layout and Explorer consumers; and the System
  Monitor toggle/report adapters.
- Baseline: 19 focused persistence, layout, System Monitor, and Explorer tests
  passed with 105 expectations at `96288d95` before the refactor.
- Verification: the original coverage plus explicit provider-fallback and
  nested-provider cases passes 21 focused tests with 120 expectations.
  `bun run check:affected` passes TypeScript and every static, architecture,
  OpenAPI, and bounded protocol-model gate; the complete app and affected
  deployment-package test suites pass, and all 38 web end-to-end tests pass.
- Delta: the provider now derives one persistent state set from the canonical
  `APP_FEATURE_FLAG_IDS` tuple and exposes one typed query/setter pair. System
  Monitor rows and toggles iterate the same registry with an exhaustive metadata
  record. Production code removes 75 lines net with no suppressions or
  source-shape baseline growth.
- Decision notes: keep the disabled no-provider behavior used by isolated
  consumers, but use that single value as the nested-provider sentinel instead
  of maintaining a separate nullable context fallback. Keep display metadata in
  System Monitor because it is presentation policy, while making its record
  exhaustive over `AppFeatureFlagId`.

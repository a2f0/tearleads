# Greenfield compatibility-removal ledger

## Boundary and authorization

The owner explicitly requested a final, separate PR removing every backward
compatibility shim, including code unrelated to #2158's follow-ups. Current
clients, current schemas, supported platforms, security checks, transactions,
cancellation, and outputs remain the preservation boundary. Older adapters,
wire shapes, product aliases, and automatic upgrades are intentionally removed.
This instruction overrides the refactoring skill's compatibility preservation.

Historical cryptographic evidence is current protocol, not compatibility.
Fail-closed detection of obsolete/corrupt data remains. No deployment or user
database has been destroyed by this cleanup.

## Baselines

- Prior issue PRs run full pre-push checks and required PostgreSQL concurrency
  checks; re-establish this final branch against their merged main before ship.
- Device-first/schema tests: 14 passed before edits, 16 after. The initial
  worktree lacked generated SQLite wasm; the official package build resolved
  that setup failure before the baseline was measured.
- Crypto keying baseline: 82 passed. Full crypto suite after explicit rekey
  heads: 125 passed.
- Remote-reset baseline: 18 passed. Reset plus policy-ownership tests after
  removal: 19 passed.
- Explicit LSN contracts: 380 client/validator tests and 4 API tests passed.
- Required inline-rekey markers: 293 validator tests and 5 API tests passed.
- Exact persisted write evidence: 548 SDK tests, 293 validator tests, and 37
  API tests passed; TypeScript and regenerated OpenAPI types passed.
- Billing aliases: 4 validator and 5 Stripe seat tests passed before/after;
  55 current-product native billing tests passed after fixture migration.
- Native store identity: 30 baseline tests passed; after removing pre-audit
  acceptance, 39 identity/claim/KEK-log API tests and 5 cursor validator tests
  passed. Missing store lineage now refuses even an exact-token event.
- OpenAPI compatibility regression fixtures pass with the brand bypass removed.
- Required provider-presentation notification: 22 app and 30 Capacitor tests
  passed, plus current SDK capability tests.
- Atomic creation: 427 baseline tests, then 656 current SDK tests passed.
- Revision-CAS persistence: 520 store/workflow/persistence tests passed; strict
  schema probes required a real SQLite executor in the reconnect fixture.
- Stripe webhook facade: 40 baseline tests, then 56 boundary/fulfillment tests
  passed. Fixed-tier-only subscription/audit handling: 64 tests passed.
- Required result-method rollout: 1,398 focused tests, then 2,520 full SDK,
  API-client, validator, and test-helper tests passed. Shared failure fixtures
  reduce repetition while retaining complete current transport metadata.
- Exact-token native claims without stored provider identity: 11 tests passed.
- Current Loro encoding boundary: 29 tests passed, including identity checks for
  current updates/snapshots and refusal of both obsolete decoder modes.
- Required blob length header: 465 API-client/validator tests passed, including
  refusal when only Content-Length is present.
- Full API SQLite suite: 1,277 passed, 48 skipped. The earlier memory run's two
  transfer fixture failures were repaired by seeding current store-audit facts;
  all 11 transfer/claim regression tests then passed without production changes.
- Full app suite: 2,356 passed, one skipped. Required authorization-target and
  structured-result fixture repairs also passed all 168 app store tests. Three
  explorer tests passed again after splitting the oversized share test file.
- TypeScript, both Knip modes, architecture, Markdown, OpenAPI regression, and
  shell checks passed before integration of the remaining issue branches.

## Completed candidates

| Candidate | Preservation proof | Intentional break |
| --- | --- | --- |
| Device-first aliases | Unified handle identity, scope, deletion, and disposal tests | Remove `openView()` and `reconciler()`; use `open()` |
| Additive local schema upgrades | Fresh schema defaults and three missing-column rejection tests; serialized ensure machinery unchanged | Old document tables require reset, never `ALTER TABLE` backfill |
| Optional rekey principal heads | Current signed rekey preserves grants and advances explicit pins; omitted/null field refused | Every `container.rekey` signs `referencedPrincipalHeads` |
| Legacy principal cache ownership | Existing organization-scoped reset tests; a misleading read-model row cannot override pinned ownership | No ownership inference or inserts during reset |
| Legacy unscoped reset cursors | Current organization/parent/document cursor tests preserve the other organization | Remove `root` and `parent:` unscoped-lane handling |
| LSN capability negotiation | Tracked PostgreSQL/SQLite and untracked Turso tests | Required response mode; no old token echo or omitted-mode default |
| Unmarked inline rekeys | Current SDK replay/rollback tests; validator marker/batch iff tests | Durable commit marker required for each non-empty batch |
| Missing historical write evidence | Historical target tamper/isolation and blob hydrate tests; required-field refusal tests | Non-null stored document/blob authorization; no current-target substitution |
| Billing product aliases | Current products retain tier mapping and native lifecycle tests | Reject all superseded Solo and SymCrypt identifiers |
| Oversized Stripe outbox state | Seat floor/tier/proration/idempotency tests | Above-largest capacity throws, never clamps |
| Pre-audit native store identity | Current native lifecycle/claim tests; exact-token/no-store refusal | Never infer durable store identity from a new claim or event |
| KEK cursor coercion | Current paging tests and malformed/non-positive/out-of-domain 400 tests | Invalid input never restarts at epoch zero |
| OpenAPI brand bypass | A renamed breaking contract fails in regression fixtures | API title changes cannot waive compatibility checks |
| Purchase presentation fallback | Current callback, cancellation, scope-change, and platform tests | Providers must notify when native UI becomes uncancellable |
| Two-request container creation | Atomic create/adoption/conflict and generation-race tests | No create-then-metadata flow or stale-generation submission |
| Optional create result methods | Current structured-failure and retry tests | Create adapters must implement structured result methods |
| Optional revision-CAS persistence | Deletion, replacement, settlement, and lifecycle race tests | No unconditional settlement aliases or three-argument error recorder |
| Stripe webhook facade | Separate authentication and fulfillment tests; route transport tests | Remove unused combined authenticate/parse/fulfill service wrapper |
| Per-seat Stripe quantities | Exact-total audit, fixed-tier identity, and outbox tests | Non-unit quantities grant no seats; audit never infers seats from quantity |
| API-client transport aliases | Current operation transport and binary-response tests | Remove request types that permitted omitting the operation contract |
| Optional link/sync result methods | Full SDK link, sync, recovery, and transport suites | Require structured methods; no nullable-method alternate path |
| Incomplete stale-policy failures | Missing/null/malformed evidence refusal and current empty-evidence acceptance | The stale-policy code requires its policy bundle array |
| Verify-without-persistence warming | Policy/checkpoint/lifecycle suites; all remaining callers formerly persisted | Remove the unreachable mode and callback/export plumbing |
| Obsolete Loro encodings | Current binary exports, update/snapshot identity and provenance tests | Refuse outdated-update/outdated-snapshot before import mutation |
| Blob byte-length header fallback | Streamed and native-buffered response tests; runtime/OpenAPI required-header assertions | Content-Length no longer substitutes for X-Tearleads-Blob-Byte-Length |

These candidates reduce branching without introducing replacement adapters.
The containing commit can be reverted independently of prior issue PRs.
Existing oversized test-file budget changes reflect required current response
and authorization fixtures. Newly oversized test files were split by behavior;
shared failure fixtures remove repeated transport metadata. Generated OpenAPI
budgets reflect the required-evidence union. The SDK documentation budget grows
to document the flag-day host contract. No production source-size allowance
was increased for incidental edits.

## Remaining audit queue

- Integrate the completed issue PRs; regenerate final contracts and exact
  temporary OpenAPI exceptions; complete validation, review, and submission.

## Rejected false positives

- Principal/container/document history, parent pins, and sealed keyrings.
- Replayable-baseline attestations, backup-version rejection, blob/roster
  integrity checks, and material-ID rejection.
- Current Stripe binding and foreign-subscription protections.
- Fail-closed rejection of incomplete or incoherent host persistence adapters
  before remote mutation; these checks do not accept alternate behavior.
- Historical invoice facts and immutable exact charged totals; unsupported
  economics can be recorded without granting licensed seat capacity.
- Current Loro encodings, appearance conversion, primary routing, and SQLite
  worker lifecycle rollback.
- Supported UUID grammar, migration-generation infrastructure, and the OpenAPI
  compatibility policy/checker itself.
- Stop-old-writer deployment guards: inspect separately from runtime shims;
  do not remove protection merely because it mentions an old deployment.

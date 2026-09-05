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
- After signed-group integration, the SDK/client/validator/test-helper/Loro
  suite passed 2,574 tests. `check:fast` passed before that integration.

## Independent review repairs

- The strict positive KEK cursor exposed an unchanged SDK first-page request
  that still sent zero. Recovery now omits the initial cursor and sends the last
  served positive epoch for continuation. Nine recovery tests pass, including
  a real `ApiClient` crossing a URL-scoped fetch boundary across two pages.
- `docs/developer/api-persistence.md` now states the operator precondition for
  migration `0015`: stop outgoing writers, preserve old evidence offline, and
  provision a fresh database when required authorization is absent. PostgreSQL
  and SQLite/Turso intentionally refuse nulls; no destructive migration or
  invented historical evidence was added.
- Group-policy current/history/checkpoint writes now require a pinned owner in
  their transaction, so organization-scoped reset cannot strand new cache rows.
  Missing/empty-owner tests prove no partial policy, history, checkpoint, or
  ownership rows remain. Older test fixtures now supply current ownership.
- Both container-failure union branches require non-empty error messages; the
  dead compound-create capability check was removed. Absent Stripe quantity
  remains invalid for fixed-tier products, and obsolete Loro imports remain
  fail-closed before mutation. Baseline/usage/attribution SQL unit fixtures are
  deliberately partial storage fixtures, not sync-response acceptance tests.
- The second review removed obsolete Turso-only assertions that expected a null
  or echoed LSN without the now-required mode. Current Turso always returns
  `0/0` and `untracked`. The dedicated remote Turso lane is not run because its
  three `TURSO_TEST_*` connection settings are unavailable; no production
  database settings are used as a substitute.
- The existing 911-line refactor ledger is preserved and links to this separate
  cleanup record. Projection-result mock defaults now consistently handle an
  explicit undefined override, while explicit implementations remain intact.
- After document-path integration, `check:fast`, TypeScript, and all 1,301 memory
  API tests pass. The combined SDK/contract run exposed only an HTTP-mocking
  collision in the new KEK transport test; its URL-scoped fetch boundary then
  passed together with all 171 API-client tests (172 tests total).

## Completed candidates

| Candidate | Preservation proof | Intentional break |
| --- | --- | --- |
| Device-first aliases | Unified handle identity, scope, deletion, and disposal tests | Remove `openView()` and `reconciler()`; use `open()` |
| Additive local schema upgrades | Fresh schema defaults and three missing-column rejection tests; serialized ensure machinery unchanged | Old document tables require reset, never `ALTER TABLE` backfill |
| Optional rekey principal heads | Current signed rekey preserves grants and advances explicit pins; omitted/null field refused | Every `container.rekey` signs `referencedPrincipalHeads` |
| Legacy principal cache ownership | Existing organization-scoped reset tests; a misleading read-model row cannot override pinned ownership | No ownership inference or inserts during reset |
| Alternate cursor namespaces | Root/child/document cursor tests and real foreign-group removal/re-addition recovery | Use one global root feed and globally unique container IDs; remove viewer-organization prefixes and optional namespace arguments |
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
| Old file-size checker entry point | Full, staged, and explicit-range source-shape checks; obsolete-flag refusal | Delete `lint:file-limits`, its forwarding shell wrapper, and its file-size-only/upstream modes |

These candidates reduce branching without introducing replacement adapters.
The containing commit can be reverted independently of prior issue PRs.
Existing oversized test-file budget changes reflect required current response
and authorization fixtures. Newly oversized test files were split by behavior;
shared failure fixtures remove repeated transport metadata. Generated OpenAPI
budgets reflect the required-evidence union. The SDK documentation budget grows
to document the flag-day host contract. No production source-size allowance
was increased for incidental edits.

## Integration and later review repairs

Review round 3 repaired the old unowned-cache case without restoring ownership
inference: scoped purge refuses current, history-only, reference-only, and
checkpoint-only group evidence without a pinned owner. Four regression cases
assert every table remains unchanged and no ownership is backfilled; all 22
remote-reset tests pass. The operator cutover precondition also names obsolete
Stripe seat outbox state. Removed six unused nullable mutation methods from
required SDK host interfaces; current API-client conveniences remain separate
from the SDK's minimum adapter contract.

Review round 4 added an explicit operator precondition for stored rekey event
bodies without signed principal heads, including historical/local copies.
Column migration success cannot certify this signed content format; reset and
reprovision rather than synthesizing evidence. The protocol overview now names
the required conditional inline-rekey marker and commit-LSN mode. A stale
container settlement comment was updated to the revision-CAS method.

Review round 5 made the cutover unconditionally fresh-database, not a partial
legacy-content audit. It explicitly names non-unit/missing Stripe subscription
item quantities and provider reprovisioning. Out-of-contract Stripe seat targets
now emit the existing operator-attention diagnostic as well as durable retry
state; no unsupported paid entitlement is fabricated.

Review round 6 tightened the public cache options and bundle-save owner argument
to required `string` types; all production callers already supplied ownership.
Malformed-JavaScript tests still prove atomic runtime refusal. Stripe seat
capacity errors now have a dedicated subtype so unrelated `RangeError`s are
not mislabeled. Documentation distinguishes the CLI's specific name/path
content checks from its column guard and the general fresh-database requirement.

Review round 7 found that unscoped parent cursors were still produced by current
callers, so merely removing their purge handling was incomplete. Re-citation's
app preflight also exposed a viewer/owner namespace mismatch that stranded
shared-container cursors after access loss. The reviewed re-citation repair
canonicalizes producers, readers, deletion, and reset together: one global root
feed, plus child/document feeds keyed by globally unique container IDs. This
integration preserves that implementation and its recovery regression; no
alternate key format or upgrade path remains. The root feed is current API
semantics, not a legacy compatibility branch.

The extracted principal-rematerialization fixture retains its explicit policy
owner. Required rekey principal heads, structured adapter methods, and atomic
checkpoint read dependencies remain intact across the issue-branch integration.

The tooling sweep found `checkFileLimits.sh`, reduced to a forwarding wrapper
when source-shape checks replaced it in #883. Its only caller was the obsolete
package-script alias. Current hooks use explicit source-shape ranges. Removed
that wrapper/alias and its private modes; unsupported arguments now fail with
usage instead of silently suppressing part of the check.

## Final integrated validation

The reviewed re-citation implementation is integrated without retaining the
abandoned historical-key-read experiment. Current-source full runs pass:

- SDK, crypto, and test-utils: 2,273 passed, no failures.
- API memory and SQLite: 1,313 passed and 49 skipped on each database.
- App: 2,357 passed, one skipped, no failures.
- TypeScript and `check:fast`, including bounded protocol models, trace and
  projection drift checks, architecture, and both OpenAPI checkers.
- Source-shape full, staged, and both explicit-range syntaxes pass. The removed
  file-size-only and upstream-resolution flags each exit unsuccessfully with
  usage, rather than silently weakening the check.

The earlier dedicated PostgreSQL cleanup run passed 59 tests, with three remote
Turso tests skipped; its disposable database was removed afterward. Required
PostgreSQL CI is checked again before handoff. Remote Turso remains untested
because its dedicated connection settings are unavailable.

The operation registry now declares its exact readonly operation tuple using
`typeof` aliases, avoiding TypeScript declaration-serialization expansion after
the required response union and re-citation endpoint are combined. Runtime
order and per-operation inference are unchanged; no broad type erasure is used.

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

## 2026-09-05 — Post-merge infrastructure rebrand cleanup

- Authorization: the owner now explicitly requests removal of the superseded
  rebrand infrastructure and permits replacing servers. This supersedes the
  earlier decision to retain the one-time deployment cleanup. No live apply,
  destroy, state migration, provider-console change, or deployment is needed.
- History: #2140 introduced the old systemd/directory cleanup; #2102 introduced
  the singleton-to-indexed website-cache address migration in both tiers.
- Preservation boundary: fresh and current Tearleads deployments retain their
  resource definitions, cache ownership, systemd units, maintenance ordering,
  health checks, firewall, secrets handling, and tier parity. Retired hosts and
  historical Terraform addresses no longer have an in-place transition path;
  use their owning configuration/state to retire them before fresh provisioning.
- Candidates: remove the Ansible cleanup/import and its ordering assertion,
  both Terraform `moved` blocks, stale backend/store/webhook cutover guidance,
  and the 50 exact OpenAPI exceptions whose removal condition was met by #2181
  (`896d4efa`). The deleted entries cite issue #2158; #2181 is the PR that
  landed the final contract on main. Replace the brand-specific backup ignore
  rules with `*backup.json`, keeping both old and current local backups ignored.
- Risk: old hosts must be replaced, not reused with old services still running;
  dropping state for live resources is not a substitute for retiring them.
- Baseline: infrastructure parity passed; Ansible lint passed on 38 files
  (toolchain deprecation messages only); Terraform formatting, two mocked
  module tests, and TFLint passed. OpenAPI compatibility fails on the now-unused
  exceptions, as expected after the contract merged.
- Verification: Ansible lint passes on 37 files after removal; infrastructure
  parity, Terraform formatting, both mocked cache tests, and TFLint still pass.
  Full `check:fast` passes, including OpenAPI compatibility without exceptions,
  its regression fixtures, bounded models, architecture, and source shape.
  The code audit finds no remaining SymCrypt references in Terraform/Ansible.
  Independent review and handoff results are recorded in the follow-up PR.
- Read-only deployment audit for the first review's operational concerns:
  staging's current and former backend states have no website-cache resource;
  production's former backend state already uses `module.website_cache[0]`.
  Neither tier needs the removed address migration. Staging has no old-brand
  systemd unit files, loaded units, `/opt/symcrypt`, or `/etc/symcrypt`; current
  Tearleads API and maintenance timers are running.
- Production remains in the former `symcrypt-terraform-state` backend; its
  current-backend server state is empty even though Hetzner still lists the
  production server. Its state-provided SSH hostname does not resolve, and it
  is not visible in the local Tailscale peer list, so its systemd state could
  not be certified. This code-only cleanup does not authorize treating that
  empty backend as a fresh production environment: retire the existing
  production resources through their owning state before fresh provisioning,
  as required by the owner's replacement-only direction. Do not run the new
  playbook on that unverified host. No server or remote state was changed.
- Shipping clarification: after reviewing that production-state warning, the
  owner explicitly confirmed the greenfield assumption and will destroy the
  existing server. This is not an in-place rollout to that host. Retirement
  through the owning state remains an operator prerequisite; the code cleanup
  does not add a temporary old-host detector or first-provisioning opt-in shim.

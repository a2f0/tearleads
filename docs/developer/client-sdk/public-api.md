# Client SDK: Public API

Part of the [client SDK guide](../client-sdk.md).

## Container primary documents

`ContainerContentsStore.setContainerPrimaryDocument(containerId, documentId)`
sets the optional canonical primary id; pass `null` to clear it. It returns the
updated `ContainerNode` after durable persistence, `null` on refused or stale
operations, and may throw on persistence failure or a target that becomes
unavailable during commit. Callers must handle both refusal and rejection.
The node exposes `primaryDocumentId` from its encrypted metadata document.

`ContainerDocumentQueries.loadContainerDocumentSummary({ containerId,
documentId })` resolves hydrated direct/secondary membership by canonical id,
returning the current device's `DocumentSummary` or `null`. Hidden tombstone
holds are excluded. `listContainerDocumentSidebarWindow` accepts an optional
`documentKind` filter applied before counting and paging. Drafts without a
canonical id cannot be selected as primary until their first sync.
Custom implementations and test doubles of `ContainerDocumentQueries` must now
implement the required `loadContainerDocumentSummary` method; this is a
source-level contract change for hosts that implement the interface themselves.

See [container views](../container-views.md) for the app extension point,
read-only behavior and fallback rules. These methods use existing root-exported
store/query contracts; there is no new package entry point or schema column.

## Public API Entry Points

Supported package entry points:

| Entry point | Use for |
| --- | --- |
| `@tearleads/client-sdk` | `Tearleads`, SDK service types, local keyring helpers, document contracts, sync diagnostics, stores, purchase capabilities, and public workflow symbols |
| `@tearleads/client-sdk/sqlite` | SQLite worker runtime factory, executor contracts, adapter helpers, and [local schema migration](../../../packages/client-sdk/src/data/sqlite/migrations/README.md) (`ensureLocalSchemaMigrated` at boot; `withLocalSchemaMigrationLock`, `migrateLocalSchema`, and the ledger check in a backup restore) |
| `@tearleads/client-sdk/sqlite/worker.js` | The SQLite worker module a host serves for `createSQLiteRuntime` |
| `@tearleads/client-sdk/sqlite/sqlite3.wasm` | The SQLite WebAssembly the host serves beside `worker.js` |
| `@tearleads/client-sdk/sqlite/sqlite3-licenses.md` | The licenses that ship with the two SQLite files |
| `@tearleads/client-sdk/testing` | Nominal trusted-identity fixtures for lower-level repository integration tests; never production code |

Each module export maps `types` to an emitted `.d.ts` file and `default` to an
emitted ESM JavaScript file under `dist`; each `sqlite/` file export names the
built file itself. Host code reaches document contracts, store facades, and
public workflow symbols through the root entry point; the SQLite entry point
owns its runtime adapter boundary, and production source never imports the
testing entry point.

Do not import `@tearleads/client-sdk/data/*` from host code. The root entry
point aggregates documented public facades;
[`data/`](../../../packages/client-sdk/src/data/) internals, deep workflow
files, and store implementation files stay private. To make a contract public,
promote it through the root entry point.

When a lower-level workflow facade name conflicts with a root service type, the
root meaning stays stable and the lower-level name gets a distinct alias. For
example, root `ContainerDocumentLinkInput` is the high-level client
document-link input, while the lower-level container query link input is
`ContainerDocumentQueriesLinkInput`.

Container KEK-history recovery is public workflow surface: `rekeyRemoteContainer`
performs an explicit rotation (and, with `keyringEntriesOverride`, the repair
that replaces a poisoned
[keyring snapshot](../../glossary/keys.md#container-kek-keyring)),
`rebuildKeyringEntriesFromLog` reconstructs history from the
`GET /containers/:id/kek-log`
[bridge log](../../glossary/keys.md#container-kek-predecessor-bridge), and
`recoverKeyringEntryFromWraps` recovers a bridge-severed epoch from the caller's
retained recipient envelope. An override must name exactly the epoch ids of the
container's verified signed lineage: a foreign id is refused as
`object_mismatch`. An omitted one throws `ContainerKeyringOverrideStaleError`,
not a verification error, since that is how a rebuild that predates a concurrent
rotation fails: rebuild and retry.

Document sync automatically plans ancestor KEK repairs before a queued write.
It repairs parent-first, shares repaired ancestors across linked paths, and
commits the signed [rekeys](../../glossary/keys.md#rekey) with the content update.
Planning does not advance checkpoints before acknowledgement; read-only sync
does not rotate keys. Child-only writers use authenticated parent public keys.
Up to 16 repairs fit inline; larger sets first commit bounded prefixes through
`rekeyContainer`, validate each acknowledgement, and refetch before planning the
next batch. Interrupted prefixes remain recoverable from the server's retained
keys. Custom sync adapters must supply `rekeyContainer` as well as document
methods. Stale ancestors remain forbidden for new ciphertext, including when a
valid recovery projection is available.

A writer whose only grant sits below a stale intermediate cannot re-key it, and
is never given its key: a stale container's KEK may be held by a revoked
ancestor member. Such a writer must never wait on another device, so a rotation
may not leave those levels stale. The API refuses a rekey, revoke, or move that
would leave a descendant above a directly granted container pinned to a retired
epoch, with `container_descendant_rekeys_required` and the `requiredContainerIds`
it must carry, parent-first. `rekeyRemoteContainer`, `revokeRemoteContainer`,
`moveRemoteContainer`, and document sync's standalone repairs answer it
themselves: they sign those rekeys against the path the batch leaves behind,
resubmit once with `containerRekeys` carried, and pin the whole batch together.
Access and keys inherit downward only while the rotator retains authority.
A self-revoke that removes write access on an owed level is refused atomically
with `container_descendant_rekeys_inaccessible`; another authorized member must
complete it. The SDK reports the refusal and returns null. Proactively carried
rekeys are also refused by the batch's signature/authorization verification.
The set is empty for almost every rotation, since a child container carries
no direct grant unless shared. At most 64 rekeys ride one rotation; beyond that
the remainder repairs lazily rather than refuse a revocation. Custom adapters
opt in by supplying the status-bearing `rekeyContainerResult`,
`revokeContainerResult`, or `moveContainerResult`, and
`getContainerWriterProjection`.

A user share whose path advanced in flight, most often under this device's own
held-descendant re-citation, is planned once more from a fresh projection that
is held to the same pins. Adapters opt in with `shareContainerResult`; without
it a stale share fails as any other refusal does. A group policy batch whose
served heads the re-citation pins past is likewise planned once more.

Principal-policy writes
[acknowledge](../../principal-history-transport.md#mutation-acknowledgements) the
committed head, its server-assigned `createdAt`, and container results, never an
echo of the submitted state. The SDK refuses a head other than the one its
authored request commits to and rebuilds the current artifacts from that
request. Group revocation returns `OrganizationGroupMutationReceipt`, that
acknowledgement; `addUserToGroup` and `removeUserFromGroup` return
`OrganizationGroupMutationResult`, that receipt plus the read model the SDK
reconciled after the commit, so a caller applies it instead of reading the read
model again. Each atomically retains current
artifacts and authenticated progress. Built-in workflows require private paged
recovery; standalone full-bundle utilities keep their explicit complete-history
contracts. See [current mutations](../principal-current-mutations.md). Missing or
substituted receipts cannot advance the local checkpoint.
The runtime journals compound policies, standalone organization policies, group
creation and group deletion before HTTP. Pending work shares one organization
lane and blocks another mutation. `AuthoredPrincipalMutation` records the kind
and route; `PrincipalMutationResponse` covers the exact receipt variants.
Advanced hosts use
`submitJournaledPrincipalMutation` and `recoverJournaledPrincipalMutation`
with durable SQLite, the actor's signing key and a current-lifetime guard.
Their `PrincipalMutationJournalContext.submit` callback must dispatch every
`kind` to its matching API route: `compound`, `group-create`, `group-delete`, or
`organization`. Missing or unsupported kinds are rejected. A compound-only
adapter cannot recover the other kinds. Keep unreadable pending bytes until the
host explicitly acknowledges the unknown outcome and discards that exact row.
An unknown result remains pending even if a later retry receives 403 or 409.
A recovered receipt acknowledges a past request without advancing current pins.
`Organizations.loadPolicyHistory(beforeVersion?)` displays verified organization
history in pages of 32 entries. The API supplies only their directory payloads,
one boundary predecessor and compact public group sources. Historical group
proofs do not admit current checkpoints. Custom hosts need private paged recovery;
older-page errors remain retryable without clearing visible entries.
Both runtime policy API variants may throw `PendingPrincipalMutationError` or
`PrincipalMutationOutcomeUnknownError`. `readJournaledPrincipalMutation` inspects
saved work. `abandonJournaledPrincipalMutation` stops retries only after an explicit
choice accepting its unknown outcome and matching that exact inspected request;
it does not undo a remote commit. Later mutations still verify current policy.
The organization facade exposes `readPendingPolicyMutation(organizationId)`,
`retryPendingPolicyMutation(organizationId)` and `abandonPendingPolicyMutation`,
whose `AbandonOrganizationPolicyMutationInput` includes the inspected request.
Org Manager shows saved work and requires confirmation before stopping retries.
Unreadable inspection throws `UnreadablePrincipalMutationError`, distinguishing
authentication and format failures. Advanced hosts can use
`discardUnreadableJournaledPrincipalMutation`; the facade exposes
`discardUnreadablePolicyMutation` with `DiscardUnreadableOrganizationPolicyMutationInput`.
Both require the inspected opaque record identifier and explicit unknown-outcome
acknowledgement. They clear only unchanged unreadable bytes, without HTTP or pin
changes. Org Manager offers the same confirmed discard action.
See [principal policy outcomes](../principal-policy-outcomes.md) for scope and limits.

Ordinary `session.createOrganization` calls durably coalesce unresolved attempts
for the same identity and full inputs, including concurrent calls and retries
after reopening SQLite. A retry can adopt an earlier committed organization;
successful local acknowledgement permits a later identical call to create anew.
Only a validated, request-bound irreversible-purge refusal releases a failed
attempt, without automatically issuing a fresh create. Ambiguous failures retain
it. Unlike pending policy mutations, creation has no public abandon/discard API;
an unusable attempt can block identical inputs indefinitely. See
[organization creation retries](../../request-budgets.md#organization-creation-retries).

A container's first direct grant has the matching precondition: the chain above
it must be current, since its new grantee could not repair it; the API refuses
one below a stale chain with `container_ancestor_rekeys_required`.
A group policy change rematerializes the group's granted containers, and a
rekey or revoke among them is a rotation like any other: `addOrganizationGroupUser`,
`removeOrganizationGroupUser`, and the other group mutations answer the same
refusal through the prepared batch's `carry` step, which re-signs the whole
batch parent-first with the named rekeys woven in (a named container the batch
already rotates is re-planned beneath them, never rotated twice), and retry
once, acknowledging every response with the batch. The batch also carries, on
its own, any level its rotations strand between two of its own containers.
Custom adapters opt in with `commitOrganizationGroupPolicyResult`; a group share
commits only grants, which rotate nothing, so it has nothing to carry. A
container that already carries a grant has had its chain kept current by every
rotation above it, so further grants and group rematerialization refreshes owe
nothing more.
`shareRemoteContainer` and `shareRemoteContainerWithGroup` re-key a lazily stale
path first, the container included, because a grant cites the parent's current
epoch and the container's key epoch must pin it. An adapter without
`rekeyContainer` cannot make that repair and gets a plain error, not one that
names another member; a sharer who cannot reach a stale level gets
`ContainerKekRepairInaccessibleError`. Under this
rule a stale container is never above a granted one, so an honest inline repair
never strands anything. The API still checks: a document write refused that way
fails with `document_sync_descendant_rekeys_required`, and the sync pass retries
with its repairs committed standalone, where each carries its own descendants.
A blob bind or detach refused that way is an uncoded 409; the document's next
sync pass makes the path current.

If a writer still meets a stale ancestor it cannot re-key (a dishonest server, a
tree past the cap in [limits.md](../../limits.md#limits-that-trade-write-liveness),
or a race), its pass refetches once, then abandons with the
`inaccessible` trace reason and reports `document_ancestor_repair_inaccessible`
to `onTerminalSubmitFailure` instead of failing the sync lane; built-in stores
keep its message, not the code, on the
[write-queue row](../../sync-edge-cases.md#queue-statuses). Its writes stay queued,
and built-in stores re-run the pass on the next `container_path_changed` hint.
Hosts that author container-scoped writes directly can call
`classifyContainerWriteRefusal` on a thrown error: `repair-required` is
retryable, `repair-inaccessible` waits on another member and names the
container, and `unauthorized` is a `ContainerAuthorAccessError`.
`ContainerKekRepairRequiredError` and its subclass
`ContainerKekRepairInaccessibleError` are exported for `instanceof` checks.
A local create or move whose path would exceed the readable length throws
`ContainerPathTooDeepError` (`code` `container_path_too_deep`) before anything
is queued; hosts can map that code to a specific message. A queued move the
API refuses with that code is abandoned and its previous placement restored.

Principal rotations and membership changes rematerialize every retained group
grant against the new current principal head in the same transaction, so
`recoverKeyringEntryFromWraps` resolves group-addressed anchors through current
verified principal policies. Rematerialization wraps only a container's current
epoch: an older epoch whose only anchor is a group wrap from before a principal
key rotation fails with `HistoricalWrapUnavailableError`
(`principal-key-unreachable`). See
[keying-design.md](../../keying-design/container-keks.md#container-key-epoch-database-row).

### Principal identity contracts

Each principal projection member, including genesis and historical evidence,
requires a lowercase SHA-256 `identityBundleFingerprint`. It commits the full
identity-link tuple: the `tearleads.identity-link.v1` separator, exact trust
domain, user ID, signing algorithm and encoded key, and encapsulation algorithm
and encoded key. `projectionRoot` authenticates that field; `membershipRoot`
remains a user-ID set, and member envelopes retain their KEM fingerprints.
Continuing members cannot change that identity bundle through a policy
transition; role changes and principal-key rotation do not replace user keys.
See the [signed projection contract](../../protocol-specification/identity-and-policy.md).

The following root exports require `identityTrustDomain: string` in their
input. Supply the already-canonical domain used by the identity gateway, not an
invented default or a request origin with the API base path stripped:

| Root export | Identity material used by the writer |
| --- | --- |
| `buildInitialGroupPolicyRequest`, `buildInitialMemberGroupPolicyRequest` | `signerUserId`, `signingKeyPair`, and `creatorEncapsulationKeyPair` for the founding member |
| `buildInitialOrganizationPolicyRequest` | `userId`, `signingKeyPair`, and `encapsulationPublicKey` |
| `createOrganizationGroup` | Forwards the domain with the creator's signing and encapsulation keys to group-policy construction |
| `registerIdentity` (`RegisterIdentityInput`) | Newly generated user ID with `signingKeyPair` and `encapsulationKeyPair`, before the first local self pin |

`TearleadsOptions.identityTrustDomain` remains an optional host override. The
client canonicalizes it; otherwise it canonicalizes an absolute `apiBaseUrl` or
resolves a relative base against the browser URL. It supplies that domain to
registration, organization provisioning, and group creation. Session and
organization service callers do not add a per-call domain argument. A
non-browser host with a relative API URL needs an absolute override.
The resolved domain includes any API base path and must exactly equal the API's
canonical `API_IDENTITY_TRUST_DOMAIN`, or its `API_PUBLIC_ORIGIN` fallback.
See [trust-domain configuration](../trusted-user-identity.md#trust-domain-configuration).

Retain `currentProjection` in complete policy bundles: internal signer
collection checks its identity commitments along with historical projections
against gateway-resolved bundles. This structural verification is not recipient
admission. Shared provisioning orchestration, signer collection,
identity-commitment helpers, and roster-admission evidence remain
package-private; this change adds no root export or deep-import entry point.

The existing callable `TrustedUserIdentityResolver` may expose
`withPinnedIdentities(ids, verify, { publish })` for structural commitment
checks. The built-in gateway batch-reads immutable pins, revalidates both keys
and their fingerprints, and passes a scoped resolver to `verify`; self identity
retains ordinary resolution. A missing pin yields the endpoint's validated
candidate without pinning it. The gateway pins those candidates as `observed`
only when `verify` succeeds with `publish` set, which callers set only after
the projection's signed state verified. The callback must not retain its
resolver for later work. Plain callable resolvers remain valid and use the
ordinary per-user path. This capability does not admit recipients, raise
provenance, or change direct resolution and signer-refetch conflict checks. A
changed database, account, or runtime generation invalidates the scoped
operation.

### Recipient admission

`organizations.addUserToGroup` and a container store's `shareWithUser` first
require direct `self`/`link` trust, then allow bounded Members-chain admission
for an existing member. It covers read, write, and admin shares, not just read
access. The complete bundle must match, not merely the recipient's KEM key.
New or disabled Members enrollment still requires direct trust. A group-add
proof is bound to the exact Members head and identity/database lifetime; a
retry that finds the target absent must recheck direct trust before enrollment.

Admission traces the target's current unbroken membership through strictly
earlier signer admissions to a direct anchor. A directly trusted signer needs
no Members entry. Other signers may have departed Members, even before a later
externally authorized action, but both their historical identity binding and
admin authority for that action must verify. The shared history scan admits at
most 64 pages of at most 32 entries and visits at most 64 non-anchor identities;
these are not a total network-request budget. Missing evidence, exhausted
bounds, self-admission, cycles, and forward-only chains cannot establish trust.

An otherwise valid but unauthenticated target raises
`UnverifiedUserIdentityError` before the mutation; availability errors propagate
separately. For group adds, Members advancing between proof and mutation
raises retryable `ProjectionDependencyUnavailableError`; the caller must retry
against the new head. Share admission is checked against the head current at
admission and is not rechecked before the share. Bundle and current or
signed-root-verified historical envelope
contradictions raise `hash_mismatch`. Signer-pin conflicts remain hard
verification failures; policy verification may reject them earlier as
`signer_mismatch`. Chain admission never promotes a pin to `self` or `link`:
`userIdentities.resolveVerified` and `createLinkFor` still require direct trust.
Contacts and roster-profile creation do not gain chain-based admission. A valid
chain trusts each authenticated administrator's vouch and cannot establish
administrator honesty. No anchor-exchange, cold-start rollback, or global
fork/currentness guarantee is added; see
[roster vouching](../trusted-user-identity.md#roster-vouching).

### Identity-format reset boundary

Identity-unbound principal evidence is not supported: there is no backfill,
legacy-envelope fallback, or mixed-format rollout. Existing server data and
client databases require a separately authorized reset before deploying this
format; old principal caches, saved progress, pending mutations, provisioning
attempts, and backups cannot simply be resumed or relabeled. Merging the change
neither performs nor authorizes a deployed-data reset. Follow the
[identity-bound reset requirements](../greenfield-reset.md#identity-bound-principal-format);
do not silently clear pins or checkpoints to make obsolete data load.

### Document identity

The root export `deriveStableDocumentId(localId): Promise<string>` returns the
planned remote id using the same namespace and algorithm as first remote
creation. It does not replace a persisted `documentId` or `recoveryDocumentId`;
those identities take precedence during sync. Hosts can read them through
`defaultDocumentsPersistence.loadDocument` and the public `DocumentRecord`.
Matching ids does not establish signer identity, write access, verified
adoption, redundant history, or permission to merge or purge a document.

### Unsaved document writes

`hasPendingLocalDocumentWrites(domainScope)` synchronously reports whether any
open document store in that domain scope holds local edits that are not durable
in SQLite yet: queued writes, and applied edits whose save failed and that no
later save or sync has covered. A store reports the two through
`hasQueuedWrites()` and `hasUnsavedLocalEdits()`. Hosts can check it before an
unload that would terminate the SQLite worker. A typing burst keeps at most one
write in flight and one queued: a queued `setText` superseded by a newer
`setText`, or an unguarded, non-deferred `setStructuredFields` patch whose
every field newer unguarded, non-deferred patches set again, never persists on
its own.

### Host-controlled mutation admission

`DocumentMutationGuard` and `DocumentMutationOptions` are named SDK root type
exports. Pass `{ stillCurrent: () => current }` as the final optional argument
to `addRow(fields, options)`, `updateRowFields(id, patch, options)`, or
`removeRow(id, options)`. `setStructuredFields(kind, patch, options)` accepts the
same guard alongside its existing `deferRemoteSync` option. Row methods accept
only the admission guard; they do not acquire deferred-sync behavior.

`stillCurrent` must be synchronous and side-effect-free. The store checks it
after readiness and again when its real local write queue admits the operation,
before Loro mutation or a pending-delta flush, including an empty structured
patch. False makes that operation a no-op. A thrown predicate also refuses,
reports through existing write-failure diagnostics, and leaves the queue usable.
`addRow` still resolves its allocated id on refusal, so an id is not a success
acknowledgement; the other methods resolve void as before. Store facades forward
the guard unchanged.

Guarded structured writes neither publish optimistically nor participate in
field-write coalescing: a later refused write cannot suppress an earlier valid
one. Omitting the guard preserves existing behavior. This is not cancellation
or rollback: initialization may run before admission, and an edit already
admitted can finish persisting even if the predicate later becomes false.
Existing unsaved edits remain available for a separately admitted retry.

### Queued document updates

Before each send, a document store merges runs of consecutive queued local
updates into one update under a fresh id, so a typing burst or an offline
backlog uploads one update per run. Custom `DocumentsPersistence` adapters
return `QueuedPendingUpdateRecord` rows (each with its `origin`) from
`listPendingUpdates` and must implement `replaceQueuedPendingUpdates`; see
[custom document persistence](../custom-document-persistence.md).

### Organization data usage

`Organizations.loadDataUsage()` returns the active organization's synced usage
as the server counts it, and `loadLocalDataUsage()` the last copy of it cached
on this device. `loadDeviceDataUsage()` instead measures what this device
stores for the active organization and resolves `OrganizationDeviceDataUsage`,
or null when no organization runtime is active; it rejects if the local read
fails. Its fields mirror `OrganizationDataUsage` without update counts:
`documents.breakdown` holds one
`OrganizationDeviceDocumentUsageCategoryBreakdown` per category, zero-filled
and in `ORGANIZATION_DOCUMENT_USAGE_CATEGORIES` order, classified by the
server's rules. Document bytes are the stored sizes of each document's keys,
history, and projected text; `blobs` counts each downloaded attachment or
pending upload once by its recorded plaintext size. The figures are logical
sizes, so they exclude SQLite page overhead and blob encryption envelopes and
are not comparable one-to-one with synced usage.

### Purchase capabilities

`OrganizationBillingView` carries `subscriptionSource` and `canCancelDirectly`
from the server billing snapshot. Use that snapshot to choose purchase controls
and inline Stripe cancellation; a native owner can still have a quarantined
Stripe subscription to cancel. Fetch the management URL separately for a native
store link. A URL lookup failure must not hide cancellation.

Org sync billing exposes two provider-neutral capabilities:

| Capability | Who owns the payment UI | Injected by |
| --- | --- | --- |
| `PurchasesCapability` | App Store or Play via RevenueCat; web and desktop use the stub | `AppHostConfig.createPurchases` |
| `DirectCheckoutCapability` | The app around Stripe's mounted element | `AppHostConfig.createDirectCheckout` |

Both have unavailable stubs. Web loads no RevenueCat SDK and purchases only
through direct checkout. `mount` takes the price the form shows, not a client
secret: nothing exists on the server until `session.confirm(startPayment)`,
which validates the form, calls `startPayment` for the client secret of the
subscription the server starts at Pay, and confirms it.
`session.updatePrice(price)` re-prices the open form when the buyer switches
plans; `startPayment` must then start that plan. The provider form collects
the billing email above the card fields and reports it through `mount`'s
`onBillingEmailChange`. The form keeps loading after `mount` resolves:
`onReady` reports it usable and `onLoadError` reports a form that never loads.
`organizations.loadStripeCheckoutOptions()` lists every plan that covers the
roster, and `organizations.createStripeCheckout(priceId)` is the usual
`startPayment` for the chosen one; `createStripeCheckoutSession(priceId,
returnUrl)` opens Stripe's hosted page for it instead. A refusal throws with
the server's billing `code`, and `billing_checkout_plan_unavailable` means the
plans must be reloaded. For a subscribed organization the same options list
the plans it can change to, and
`organizations.changeStripePlan(priceId, currentSeatCount)` (the capacity the
admin chose against) returns `upgraded` (charged now and applied),
`scheduled` (at renewal), or `kept`; it throws
`billing_plan_change_payment_failed` for a declined upgrade and
`billing_plan_change_unavailable` for a plan it cannot change to now,
including when the current plan changed meanwhile.
Native purchases are personal-org only. Handle
`PurchaseAlreadyOwnedError` with `purchases.moveNativeSubscription`: verify the
receipt, prepare a fresh org outside the claim deadline, claim it, then publish
attribution. Identity pending means retry; provider stalled means restart.
Before purchase or restore, use
`checkNativePurchaseEligibility(organizationId, store)` to block a second
subscription; claims and webhooks still recheck ownership and conflicts. Native
providers must invoke the supplied `onProviderPresented` callback exactly when
their store sheet becomes uncancellable. Before that notification, cancellation
must prevent later presentation; there is no capability flag or conservative
provider-start fallback. Keep restore/claim/bind atomic.
See [revenuecat-billing.md](../revenuecat-billing.md).

## Package Contract

The package is `private: true` and consumed across the monorepo by build output.
The build emits ESM JavaScript, inline-source source maps, and declaration files
from [`tsconfig.build.json`](../../../packages/client-sdk/tsconfig.build.json),
replacing any previous `dist`:

```sh
bun run --filter='@tearleads/client-sdk' build
```

`bun run lint:architecture` enforces the package-consumption contract:

- `@tearleads/client-sdk` is private, ESM, side-effect-free, and backed by
  build-output package exports.
- Local `@tearleads/*` package dependencies use `workspace:*` ranges.
- The package export map matches the
  [entry-point table](#public-api-entry-points) exactly and points at `dist`
  JavaScript/declaration files.
- [`data/`](../../../packages/client-sdk/src/data/), document, store, workflow,
  and deep implementation package exports are rejected.
- App code uses SDK root services instead of importing SDK workflow or store
  facades directly.
- Product window vocabulary such as `OrgManager` and `mini-app` stays in
  [`packages/app`](../../../packages/app/); SDK source uses platform workflow names.

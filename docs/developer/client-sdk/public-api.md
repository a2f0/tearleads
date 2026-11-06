# Client SDK: Public API

Part of the [client SDK guide](../client-sdk.md).

## Public API Entry Points

Supported package entry points:

| Entry point | Use for |
| --- | --- |
| `@tearleads/client-sdk` | `Tearleads`, SDK service types, local keyring helpers, document contracts, sync diagnostics, stores, purchase capabilities, and public workflow symbols |
| `@tearleads/client-sdk/sqlite` | SQLite worker runtime factory, executor contracts, and adapter helpers |
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
point aggregates documented public facades; `data/*` internals, deep workflow
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
exact submitted state and current artifacts without retransmitting
`previousStates`. The SDK verifies that receipt against its authored request.
Group revocation returns `OrganizationGroupMutationReceipt`; `addUserToGroup`
and `removeUserFromGroup` return `OrganizationGroupMutationResult`, that receipt
plus the read model the SDK reconciled after the commit, so a caller applies it
instead of reading the read model again. Each atomically retains current
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
through direct checkout, whose provider form collects the billing email above
the card fields and reports it through `mount`'s `onBillingEmailChange`.
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
from `tsconfig.build.json`, replacing any previous `dist`:

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
- `data/*`, document, store, workflow, and deep implementation package exports
  are rejected.
- App code uses SDK root services instead of importing SDK workflow or store
  facades directly.
- Product window vocabulary such as `OrgManager` and `mini-app` stays in
  [`packages/app`](../../../packages/app/); SDK source uses platform workflow names.

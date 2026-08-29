# Billing lapse purge and recovery

Organization billing moves through `disabled -> deleting -> purged` after its
entitlement ends and the configured grace period expires.

- `disabled`: sync writes are rejected, but read-only document pulls remain
  available during the grace period.
- `deleting`: the purge worker owns the organization. Every document sync
  request, including a pull, is rejected. The client may clear that
  organization's remote-derived state, but it keeps local Loro history and
  attachment bytes.
- `purged`: remote containers, documents, access history, read-model data, and
  blob objects are gone. The retained organization, roster, user, and billing
  rows form a dormant control plane. The old organization is terminal and
  cannot be reactivated by a late Stripe or RevenueCat event.

Purge claims use a lease. A failed database or object-store deletion leaves the
organization in `deleting`; a later maintenance pass resumes it. The worker
marks the organization `purged` only after its remote database state and
durable object-deletion work are both complete.

## Client recovery

`clearRemoteSyncState(organizationId)` is organization-specific. It clears only
that organization's remote identities, projections, intents, and cursor lanes,
then queues the retained local histories for republish. Sync remains blocked
while the server reports `deleting`.

After the old organization reports `purged`, `recoverPurgedOrganization`
provisions a fresh organization id and root container. The old local root is
rebound beneath the fresh root, and retained documents are recreated using
their former server document ids as deterministic recovery identities. This
lets multiple devices race safely: the first create wins and the other clients
adopt the same remote document rather than creating duplicates.

Split-view clients use separate Loro peer ids. Their full histories therefore
form ordinary concurrent branches and converge when both reach the recovered
remote document. A reused peer/counter is not treated as ordinary concurrency:
equal frontiers with different full-history identities expose the collision,
and conflicting bytes for one server update id are rejected with a conflict.

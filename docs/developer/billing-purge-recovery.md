# Billing-Purge Recovery

A billing lapse disables remote sync for the affected organization. Once its
retention window expires, the server moves billing to `deleting`, rejects sync,
and purges organization-owned remote data. Sync remains blocked after the state
reaches `purged`; a replacement organization is required before it can resume.

`clearRemoteSyncState(execSql, { organizationId })` remains available while
sync is blocked. It clears only that organization's server-derived rows,
cursors, remote identifiers, and queued remote work. Durable local Loro history
and attachment sources remain available for republishing. A replacement reset
also accepts a fresh organization id and root container id and rebinds the
retained local records to them.

Reset scope comes from local container ownership and document projections,
including document-to-container links. Organization and roster profile pointers
in the server read model cannot add documents to that scope. A profile document
with a local projection for the affected organization still resets even when it
has no current container projection.

Reset preserves principal-policy checkpoints and their organization ownership,
and access-manifest checkpoints for containers and documents. Cached policy
bundles may be cleared, but later verification still rejects rollback and forks
against those durable observations. Repeated resets preserve the same anchors.
Access checkpoints include the organization id in their identity, so a fresh
replacement organization can reuse local container ids without erasing the old
organization's trust history. Reset within the same organization cannot make a
conflicting genesis acceptable. These anchors remain until the local database
is fully reset; purged-organization cleanup must not remove them. The discovery
cache compares each signed head against its own organization's checkpoint, so
retaining an old organization's pin does not disable caching after recovery.
The cache's required organization column is a greenfield schema change: this
release expects a fresh local database and intentionally provides no legacy
schema upgrade, backfill, or compatibility path.

Authenticating the replacement response remains open in
[#2365, finding #10](https://github.com/a2f0/tearleads/issues/2365).

Normal clients should call `session.recoverPurgedOrganization(...)` only after
the server reports `purged`. The session provisions a replacement personal
organization in local-only billing state. Until that replacement has active
billing and the current user has a sync seat, recovery throws
`PurgedOrganizationRecoveryBillingRequiredError` with the stable replacement
organization and root-container ids; callers use the organization id for trial
or checkout and retry recovery. The app's Organization Billing panel performs
this handoff automatically. It keeps the purged organization active locally,
targets every replacement billing read and purchase explicitly, and retries the
same durable recovery after billing becomes sync-eligible.
The old organization's local data and the server default-organization pointer
remain bound to the old id during this billing wait, so re-authentication still
opens the retained organization. Once the replacement is sync-eligible, the
session clears the purged organization's remote state transactionally, then
replays the durable provisioning request with replacement finalization. The
server rechecks billing and the current user's sync seat before moving the
default pointer. Only then does the session remove its durable attempt and
resume under the new id. Lost responses and interrupted resets remain
idempotent.

SDK organization billing methods that can initiate a replacement purchase
accept an explicit organization id. Hosts must use that target while recovery
is waiting rather than temporarily switching the session, which would make a
restart lose the purged source id before local rebind and server finalization.

Only one replacement can win. When two devices race with different candidate
organization ids, the server stores the first complete provisioning response
and returns it to later devices. Losing devices adopt that response and do not
persist their unrelated candidate bootstrap. Their retained local histories
then sync into the same replacement organization, where ordinary Loro frontier
convergence applies; divergent operations that reuse the same peer/counter are
quarantined before live import.

The root package exports `RemoteResetInput`, `RemoteResetReplacement`,
`ClearRemoteSyncStateResult`, and
`PurgedOrganizationRecoveryBillingRequiredError` for hosts that own session
or billing orchestration. Most applications should use the session recovery
method instead of calling the low-level reset directly.

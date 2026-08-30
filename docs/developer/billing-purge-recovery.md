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

Normal clients should call `session.recoverPurgedOrganization(...)` only after
the server reports `purged`. The session provisions a replacement personal
organization in local-only billing state. Until that replacement has active
billing and the current user has a sync seat, recovery throws
`PurgedOrganizationRecoveryBillingRequiredError` with the stable replacement
organization id; callers use that id for trial or checkout and retry recovery.
The old organization's local data and the server default-organization pointer
remain bound to the old id during this billing wait, so re-authentication still
opens the retained organization. Once the replacement is sync-eligible, the
session clears the purged organization's remote state transactionally, then
replays the durable provisioning request with replacement finalization. The
server rechecks billing and the current user's sync seat before moving the
default pointer. Only then does the session remove its durable attempt and
resume under the new id. Lost responses and interrupted resets remain
idempotent.

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

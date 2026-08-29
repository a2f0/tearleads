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
organization, clears the purged organization's remote state transactionally,
and then resumes sync under the new id. A durable provisioning attempt makes a
lost server response retryable.

Only one replacement can win. When two devices race with different candidate
organization ids, the server stores the first complete provisioning response
and returns it to later devices. Losing devices adopt that response and do not
persist their unrelated candidate bootstrap. Their retained local histories
then sync into the same replacement organization, where ordinary Loro frontier
convergence applies; divergent operations that reuse the same peer/counter are
quarantined before live import.

The root package exports `RemoteResetInput`, `RemoteResetReplacement`, and
`ClearRemoteSyncStateResult` for hosts that own session orchestration. Most
applications should use the session recovery method instead of calling the
low-level reset directly.

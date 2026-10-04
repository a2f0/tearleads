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
The cache is keyed by document and organization, so their epoch counters remain
independent. Its required organization column is a greenfield schema change:
this release expects a fresh local database. The existing schema guard rejects
obsolete caches with a local-database-reset error; there is no schema upgrade,
backfill, or compatibility path.

Replacement provisioning carries an explicit identity signature under the
`tearleads.organization-replacement.v1` domain. It binds the old organization,
new organization, user, root container, root metadata document, organization
policy genesis hash, Admins and Members group IDs and genesis hashes, and root
manifest genesis hash. The SDK signs this intent only for a fresh personal
organization whose sole founding authority is the current user and whose root
is private, parentless, and not a system container. An ordinary signed root is
insufficient authority to re-home the corpus.

The API requires `replacementAuthorization` for every replacement request and
checks it against the submitted signed provisioning artifacts before creation,
stored-winner replay, and finalization. Ordinary organization requests omit it;
the response always includes the field, with `null` for ordinary creation. The
SDK verifies a replacement response with its locally held signing public key,
checks every returned destination field, and atomically pins the winning root
and all three principal genesis hashes before adopting IDs or resetting data.
Conflicting genesis or organization ownership aborts the pin transaction; later
observed checkpoints are retained. A losing device trusts the winner's explicit
signature from the same identity, without persisting its own unrelated
bootstrap.

Missing, malformed, foreign-signed, or mismatched proofs stop recovery and leave
the old corpus and checkpoints intact. The durable attempt keeps the exact
original signature and artifacts for retry. Finalization responses are verified
again before clearing that attempt or switching the session. This is the current
wire and local attempt contract. Stored server replacement and native-restore
provisioning responses also require the new field; old server rows require the
greenfield reset. No legacy artifact decoder or migration exists.
Discovery and listing-tombstone verification check each live signed or cached
head against the listed
container's current organization, so an old organization's proof cannot populate
reused local IDs after recovery. Missing organization scope leaves discovery
pending.
See [the bounded recovery model](../../formal/local-trust/PurgeRecovery.md).

Re-shared folders also recover on other members' devices (#2389). The client
pins the organization's verified genesis signer and key fingerprint when reading
policy evidence, retaining that binding across cache eviction, logout, and backup
restore. A replacement chain must be signed by that original founder, and the
destination folder must be created by the same user. The verified destination's
organization genesis and root genesis must match the proof. Its root and reserved
group genesis checkpoints are pinned before adoption. The existing held-folder
rebind keeps queued edits and resets the remote metadata stream.

`GET /containers/:id/replacement-authorizations/:replacesOrganizationId` serves
the chain only to a current reader of the destination container. Former members
cannot discover replacement IDs merely through the old roster. A previously
disabled member can follow when deliberately invited and granted access in the
new organization; no old grant or roster status automatically grants new access.
Missing authority or proof leaves the old binding and queued edits untouched.
Multiple replacements use a continuous signed chain, without a lifetime cap.

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

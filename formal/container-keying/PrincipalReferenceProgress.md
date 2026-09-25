# Group references across grants and rekeys

[`PrincipalReferenceProgress.tla`](./PrincipalReferenceProgress.tla) models
finding #5 in #2266. A container grant or rekey must cite the current group
policy at API commit. A signed successor also cannot roll a group's reference
back below its predecessor, even when a dishonest server serves it. Finding 4
of #2365 adds container deletion: retained signed grants do not require a
mutation of a deleted container when the group advances.

| Model action or predicate | Production seam |
| --- | --- |
| `Commit` / `EnforceCurrent` | `assertGroupReferenceHeadsCurrent` compares all head fields with stored current states |
| `Progresses` / `EnforceProgress` | `assertContainerPrincipalReferencesProgress` checks signed predecessor references |
| `AdvanceGroup` | `applyPrincipalContainerRematerializations` updates direct grants atomically with the group |
| `Delete` / `FilterDeletedGrants` | `deleteContainer`, `listCurrentPrincipalContainerGrants`, `livePrincipalContainerGrants` preserve history and require mutations only for live containers |
| `DeletedGrantsDoNotBlockProgress` | `applyPrincipalContainerRematerializations`, `requireOrganizationGroupWithoutDeleteBlockers`, `assertOrganizationUsersHaveNoCurrentDirectContainerGrants` ignore retired grants |
| `VerifySuccessor` | `verifyContainerAccessManifest` applies reference progress during read verification |

The configuration contains one granted container and one initially ungranted
container, with group versions bounded at three. Zero means no group grant.
Disabling API currentness allows a new grant to select an old group key even
with predecessor monotonicity enabled. Disabling shared progress allows a
dishonest server's successor to move a device backward even when API commit
validation is enabled. A third negative control keeps deleted grants in the
required set and blocks group progress.

The verifier compares references to the signed predecessor, without requiring
current group membership for historical signer authorization. Honest late
delivery remains covered by `NoBrickedDevice`. This model abstracts signatures,
key bytes, and same-version hash forks; implementation tests check reference
version, key epoch, state hash, and fingerprint. Group locking is represented
by atomic commit and rematerialization actions. The SDK uses a coded missing
projection only to plan a batch; the API independently enforces the complete
live set. An unsigned omission cannot authorize skipping a live rotation.

The history comparison covers references present in consecutive signed states.
A revoked group has no successor reference to compare; a later re-grant still
passes the API's locked current-head check. This model does not represent revoke
and re-grant or freshness of a first-seen policy on a dishonest server.

## Client retirement evidence

A coded container-not-found response is only a planning hint. The SDK keeps the
signed grant and records skipped container IDs atomically with the exact verified
policy acknowledgement. Failed or unacknowledged commits do not retire anything.
Current projection and local acknowledgement checkpoint transactions reject a
later head for one of those IDs as equivocation; historical evidence remains
usable. `deletedContainerGrantReappearance.test.ts` exercises a dishonest 404,
a successful rotation, and the contradictory old-key reappearance. This durable
client expectation is tested at runtime, outside this model's honest-API progress
abstraction. No compatibility or grant-rewriting path is involved.

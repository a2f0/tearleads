# Group references across grants and rekeys

[`PrincipalReferenceProgress.tla`](./PrincipalReferenceProgress.tla) models
finding #5 in #2266. A container grant or rekey must cite the current group
policy at API commit. A signed successor also cannot roll a group's reference
back below its predecessor, even when a dishonest server serves it.

| Model action or predicate | Production seam |
| --- | --- |
| `Commit` / `EnforceCurrent` | `assertGroupReferenceHeadsCurrent` compares all head fields with stored current states |
| `Progresses` / `EnforceProgress` | `assertContainerPrincipalReferencesProgress` checks signed predecessor references |
| `AdvanceGroup` | `applyPrincipalContainerRematerializations` updates direct grants atomically with the group |
| `VerifySuccessor` | `verifyContainerAccessManifest` applies reference progress during read verification |

The configuration contains one granted container and one initially ungranted
container, with group versions bounded at three. Zero means no group grant.
Disabling API currentness allows a new grant to select an old group key even
with predecessor monotonicity enabled. Disabling shared progress allows a
dishonest server's successor to move a device backward even when API commit
validation is enabled. Both violations are registered negative controls.

The verifier compares references to the signed predecessor, without requiring
current group membership for historical signer authorization. Honest late
delivery remains covered by `NoBrickedDevice`. This model abstracts signatures,
key bytes, and same-version hash forks; implementation tests check reference
version, key epoch, state hash, and fingerprint. Group locking is represented
by atomic commit and rematerialization actions.

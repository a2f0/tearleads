# Terminal anchors across backup restore

[`TerminalAnchors.tla`](./TerminalAnchors.tla) checks that restoring an older
or independently produced backup preserves every local trust anchor, of three
kinds:

- **immutable** pins, here terminal purge decisions: once set, a pin never
  changes, and a backup carrying a different value is refused;
- **append-only** evidence, here security incidents: a restore only adds;
- **monotone** checkpoints, here a verification checkpoint: a restore never
  moves one below its position or swaps the hash signed at a position.

A purge value abstracts the organization, document manifest hash, and purge
event hash; any difference for the same document is a conflict, without an
epoch comparison. A checkpoint is a position (an epoch or version) with the
hash signed at it.

| Model action or predicate | Production seam |
| --- | --- |
| `ObservePurge` | `storeDocumentPurgeCheckpointInTransaction` |
| `ObserveIncident` | `appendSecurityIncident` |
| `AdvanceCheckpoint` | `advanceKeyingCheckpointsAtomically` |
| `Preflight` | `preflightSecurityAnchorRestore` |
| `Restore` | `restoreBackupDatabase` repeats the merge in its write transaction |
| `Compatible` / `MergePins` | `mergeDocumentPurgeCheckpointBackupTables` and `mergePrincipalPolicyOwnerBackupTables` |
| `RestoredIncidents` | `mergeSecurityIncidentBackupTables` |
| `MergeCheckpoint` / `CheckpointsCompatible` | `mergeAccessManifestCheckpointBackupTables` and `mergePrincipalPolicyCheckpointBackupTables` |

Every production anchor table is one of the three kinds;
`securityAnchorBackupColumns` lists them, and `mergeSecurityAnchorBackupTables`
merges each by its kind:

| Table | Kind | Merge |
| --- | --- | --- |
| `document_purge_checkpoints` | immutable | union; a different value for one document is refused |
| `principal_policy_organizations` | immutable | union; a different owning organization is refused |
| `organization_founders` | immutable | union; a different founder is refused |
| `trusted_user_identity_pins` | immutable | union; a different pinned identity is refused |
| `principal_grant_retirements` | immutable | union of retired grants |
| `security_incidents` | append-only | union under the retention rule below |
| `access_manifest_checkpoints` | monotone | the higher epoch; one hash per epoch |
| `principal_policy_checkpoints` | monotone | the higher version; one hash per version |

The model checks one representative of each kind. Some local tables are
deliberately not anchors, because losing them costs only a refetch:
`document_history_checkpoints` holds each document's Loro content snapshot;
`principal_policies` and `principal_policy_bundle_history` cache verified
bundles; `principal_history_prefixes`, `principal_history_entries`, and
`principal_history_nodes` hold proof material checked against a private root;
and the organization read model is presentation state.

The bounded configuration uses one document, two conflicting purge decisions,
two incidents, and a checkpoint with two positions and two hashes. TLC checks
that purge pins never change once observed, incident evidence never
disappears, and checkpoints never regress across any sequence of observations,
checkpoint advances, preflights, and restores. The run explores 136,235
distinct states. The implementation regression drives the real SQLite
restore, including backups without either table, independent rows, repeated
observations, and conflicting purge evidence.

`PreserveAnchors = FALSE` replaces the local tables with the backup's instead
of merging them. `RecheckAtCommit = FALSE` uses a stale preflight merge and
loses a decision observed before the write transaction. Registered negative
controls exercise both the purge-pin and incident-evidence properties, as well
as the stale-preflight race. `MergeCheckpointsByMax = FALSE` restores a
backup's older checkpoint and violates `CheckpointsNeverRegress`. A backup
signing a different hash at the local checkpoint's position is forked evidence
and refuses the whole restore; the merge itself never replaces a local row at
an equal position.

The model abstracts incident counts and timestamps; implementation tests check
their idempotent maximum-count and enclosing-time-window merge. Deliberate
ledger retention and deletion of the entire local database are outside the
restore invariant. Backup encryption, signature checking, SQL schema parsing,
and blob rollback are also outside this bounded model.

Restore also validates each incident ID against its serialized identity fields,
requires canonical ISO observation timestamps, and applies the ledger's newest
1,000 rows per trust-domain limit after the union. Existing local incidents
keep their places; any remaining capacity is filled with the newest imported
incidents. Timestamp ties use descending incident ID, matching SQLite. These
representation and retention rules are
covered by implementation tests rather than the two-incident abstraction.

Restored incident observations more than five minutes ahead of the restoring
device are refused, so an imported future clock cannot suppress subsequent
incidents indefinitely through retention ordering. Correcting that clock and
retrying restore preserves the evidence without rewriting its timestamps.

Principal-policy organization ownership follows the same immutable union rule:
a principal's type and ID select one organization, which cannot be replaced by
an older backup. In that interpretation the model's document key represents a
principal key and its pin value represents the organization ID. Checkpoint
versions follow the monotone kind above. The restore keeps current-only
ownership, imports backup-only ownership, and rejects conflicting owners before
writing. Retaining a group checkpoint without its owner would strand later
organization-scoped recovery. Native SQLite regressions cover restoring an
empty or absent owner table, merging overlapping scopes, conflict refusal, and
successful remote-state reset after restore. Preflight refuses any merged group
checkpoint that has no owner, before changing the database. Ownership is never
inferred from display rows or backfilled from unsigned metadata.

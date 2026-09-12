# Terminal anchors across backup restore

[`TerminalAnchors.tla`](./TerminalAnchors.tla) models finding #9 in #2266.
Restoring an older or independently produced backup must preserve every local
terminal purge decision and every retained security incident. A purge value
abstracts the organization, document manifest hash, and purge event hash; any
difference for the same document is a conflict, without an epoch comparison.

| Model action or predicate | Production seam |
| --- | --- |
| `ObservePurge` | `storeDocumentPurgeCheckpointInTransaction` |
| `ObserveIncident` | `appendSecurityIncident` |
| `Preflight` | `preflightSecurityAnchorRestore` |
| `Restore` | `restoreBackupDatabase` repeats the merge in its write transaction |
| `Compatible` / `MergePins` | `mergeDocumentPurgeCheckpointBackupTables` |
| `RestoredIncidents` | `mergeSecurityIncidentBackupTables` |

The bounded configuration uses one document, two conflicting purge decisions,
and two incidents. TLC checks that purge pins never change once observed and
incident evidence never disappears across any sequence of observations,
preflights, and restores. The implementation regression drives the real SQLite
restore, including backups without either table, independent rows, repeated
observations, and conflicting purge evidence.

`PreserveAnchors = FALSE` reproduces the original table-replacement bug.
`RecheckAtCommit = FALSE` uses a stale preflight merge and loses a decision
observed before the write transaction. Registered negative controls exercise
both the purge-pin and incident-evidence
properties, as well as the stale-preflight race.

The model abstracts incident counts and timestamps; implementation tests check
their idempotent maximum-count and enclosing-time-window merge. Deliberate
ledger retention and deletion of the entire local database are outside the
restore invariant. Backup encryption, signature checking, SQL schema parsing,
and blob rollback are also outside this bounded model.

Restore also validates each incident ID against its serialized identity fields,
requires canonical ISO observation timestamps, and applies the ledger's newest
1,000 rows per trust-domain limit after the union. Timestamp ties use descending
incident ID, matching SQLite. These representation and retention rules are
covered by implementation tests rather than the two-incident abstraction.

Restored incident observations more than five minutes ahead of the restoring
device are refused, so an imported future clock cannot suppress subsequent
incidents indefinitely through retention ordering. Correcting that clock and
retrying restore preserves the evidence without rewriting its timestamps.

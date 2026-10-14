# Principal recovery reuse

[`PrincipalRecoveryReuse.tla`](./PrincipalRecoveryReuse.tla) checks the reuse
of completed private principal-history stages introduced by
[#2522](https://github.com/a2f0/tearleads/issues/2522). An honest server
advances the organization directory head; a group revocation is a rotation
committed with a directory successor, so it is an advance. Each scoped recovery
batch reads the server-current head once, then recovers that exact head. A
completed local stage of the pinned head is accepted without a confirmation
read. Stored current artifacts that fail verification are replayed online
instead of refused.

| Model action or predicate | Production seam |
| --- | --- |
| `ServerAdvance` | `commitOrganizationGroupPolicy` commits a group successor with its directory successor |
| `AdmitPin` | `advanceKeyingCheckpointsAtomically` admits a verified head as the durable pin |
| `Interrupt` | `savePrincipalHistoryStage` persists an incomplete page boundary |
| `StoreRejectedCurrent` | `acceptPage` saves a completed stage before `verifyPrincipalPolicyCurrent` checks its current artifacts |
| `BeginBatch` / `Collect` | `recoverPolicyDirectory` runs `discoverDirectoryHead`, then recovers that exact head |
| `Recover` | `readRecoveryPages` skips the read for a completed stage of the pinned head; `StoredPrincipalCurrentRejectedError` discards the stage and replays online |
| `FreshPerBatch` | the bare discovery read in `discoverDirectoryHead` selects the server-current head |
| `NoRollback` | `verifyPrincipalPolicyCheckpoint` and the checkpoint reload in `finishRecovery` |

The positive configuration explores three heads and three batches. Three
negative controls in `scripts/protocol/protocolHistoryNegativeControls.ts`
disable one guard each:

- `DiscoverEachBatch = FALSE` violates `FreshPerBatch`: trusting the newest
  completed local head instead of discovering misses a revocation committed
  before the batch began.
- `ShortcutRequiresComplete = FALSE` violates `AcceptedHeadVerified`: skipping
  the read for partial progress accepts a head whose history was never checked.
- `ReplayRejectedStoredCurrent = FALSE` violates `HonestServerNeverRefused`: a
  completed stage holding rejected current artifacts would refuse the honest
  server forever, which is the bricked-device shape `NoBrickedDevice` forbids.

Public projection sources follow the same rule: `readPublicPages` skips its
pinned read once progress is complete, and every read that does occur checks
the returned head artifacts against the private root. The model abstracts
signatures, pages, the public/private split, and concurrent writers; the
signed SDK regressions in `principalHistoryRecovery.test.ts`,
`recoverPublicPrincipalHistory.test.ts` and
`runtimeProjectionPolicyRecovery.test.ts` cover those boundaries. It does not
model the server's read authorization: dropping a confirmation read removes a
refusal of evidence the device already verified, and writes stay authorized
against live server state.

# Principal recovery reuse

[`PrincipalRecoveryReuse.tla`](./PrincipalRecoveryReuse.tla) checks how
authenticated principal-history recovery is reused
([#2522](https://github.com/a2f0/tearleads/issues/2522)). An honest server
advances the organization directory head; a group revocation is a rotation
committed with a directory successor, so it is an advance. Each workflow
operation reads the server-current head once (the bare discovery read), then
recovers that exact head. A completed local stage of the pinned head is accepted
without a confirmation read, and stored current artifacts that fail verification
are replayed online instead of refused. Later collections in the same operation
reuse the recovered directory until a realtime organization hint or a durable
pin past a memoized head evicts it. The memo never outlives its operation.
Organization provisioning primes the founding heads the device signed: after
the server acknowledges the commit, the ordinary verifier checks the device's
own states into completed stages, so the first recovery reads only discovery.

| Model action or predicate | Production seam |
| --- | --- |
| `ServerAdvance` | `commitOrganizationGroupPolicy` commits a group successor with its directory successor |
| `Hint` | `applyOrganizationReadModelResponse` applies a hinted read-model change and calls `invalidatePrincipalRecovery` |
| `AdmitPin` | `advanceKeyingCheckpointsAtomically` admits a verified head as the durable pin |
| `PrimeProvisioned` | `persistOrganizationProvisioningState` pins the acknowledged founding heads, then `primeProvisionedPrincipalHistory` verifies them into completed stages |
| `Interrupt` | `savePrincipalHistoryStage` persists an incomplete page boundary |
| `StoreRejectedCurrent` | `acceptPage` saves a completed stage before `verifyPrincipalPolicyCurrent` checks its current artifacts |
| `BeginOperation` / `EndOperation` | `createRuntimePrincipalPolicyWarmer` creates one operation memo, discarded with the warmer |
| `ReuseMemo` / `MemoUsable` | `reusableEntry` checks the producer lease, the hint epoch, and `directoryMemoValidity` pin coverage |
| `Collect` | `recoverPolicyDirectory` runs `discoverDirectoryHead`, then recovers that exact head |
| `Recover` | `readRecoveryPages` skips the read for a completed stage of the pinned head; `StoredPrincipalCurrentRejectedError` discards the stage and replays online |
| `FreshPerOperation` | the bare discovery read in `discoverDirectoryHead` runs once per operation |
| `NoStaleAfterHint` | `principalRecoveryEpoch` changes after a hint, so the next collection rediscovers |
| `NoRollback` | `directoryMemoValidity` reloads every named head's durable pin through `loadPrincipalPolicyCheckpoint` |

The positive configuration explores three heads, three operations and two
hints. Seven negative controls in
`scripts/protocol/protocolHistoryNegativeControls.ts` disable one guard each:

- `DiscoverEachOperation = FALSE` (with hints disabled) violates
  `FreshPerOperation`: trusting the newest completed local head instead of
  discovering misses a revocation committed before the operation began.
- `ShortcutRequiresComplete = FALSE` violates `AcceptedHeadVerified`: skipping
  the read for partial progress accepts a head whose history was never checked.
- `ReplayRejectedStoredCurrent = FALSE` violates `HonestServerNeverRefused`: a
  completed stage holding rejected current artifacts would refuse the honest
  server forever, the bricked-device shape `NoBrickedDevice` forbids.
- `MemoPerOperation = FALSE` violates `FreshPerOperation`: a memo that outlives
  its operation serves a directory older than the next operation's start.
- `EvictOnHint = FALSE` violates `NoStaleAfterHint`: a hinted advance would not
  reach later collections of an operation already in flight.
- `EvictOnCheckpoint = FALSE` violates `NoRollback`: another operation's newer
  durable pin would sit above the memoized directory. Production checks the
  organization pin and the pin of every group head the directory names; a pin
  advanced exactly to a memoized head keeps it, since the device admitted what
  the memo holds.
- `PrimeRequiresAcknowledgement = FALSE` violates `NoRollback`: priming a head
  the server never acknowledged pins the device past the honest server, which
  then refuses the server's own head as a rollback.

Public projection sources follow the completed-stage rule: `readPublicPages`
skips its pinned read once progress is complete, and every read that does occur
checks the returned head artifacts against the private root. Hints are lossy,
so `FreshPerOperation` rests on the discovery read alone; hint eviction only
shortens reuse inside an operation. The model abstracts signatures, pages, the
public/private split, the producer lease, and concurrent recovery writers; the
signed SDK regressions in `principalHistoryRecovery.test.ts`,
`principalRecoveryMemo.test.ts`, `principalRecoveryOperation.test.ts` and
`runtimeProjectionPolicyRecovery.test.ts` cover those boundaries. It does not
model the server's read authorization: dropping a confirmation read removes a
refusal of evidence the device already verified, and writes stay authorized
against live server state.

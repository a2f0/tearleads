# Principal recovery reuse

[`PrincipalRecoveryReuse.tla`](./PrincipalRecoveryReuse.tla) checks how
authenticated principal-history recovery is reused. An honest server
advances the organization directory head; a group revocation is a rotation
committed with a directory successor, so it is an advance. Each workflow
operation reads the server-current head once (the bare discovery read), then
recovers that exact head. A completed local stage of the pinned head is accepted
without a confirmation read, and stored current artifacts that fail verification
are replayed online instead of refused. Later collections in the same operation
reuse the recovered directory until a realtime organization hint or a durable
pin past a memoized head evicts it. The memo never outlives its operation, and
a value it hands out stays bound to its producer's lifetime until it is used.
Organization provisioning primes the founding heads the device signed: after
the server acknowledges the commit and the bootstrap pins them, the ordinary
verifier checks the device's own states into completed durable stages in a
later step. That step is bound to the provisioning identity and database and
writes nothing once either changed. Priming writes no memo entry, so the first
recovery still discovers and only skips the confirmation read.

| Model action or predicate | Production seam |
| --- | --- |
| `ServerAdvance` | `commitOrganizationGroupPolicy` commits a group successor with its directory successor |
| `Hint` | `applyOrganizationReadModelResponse` applies a hinted read-model change and calls its database's `PrincipalPolicyCoordinator.invalidateRecovery` |
| `AdmitPin` | `advanceKeyingCheckpointsAtomically` admits a verified head as the durable pin |
| `ProvisionPin` | `persistRegistrationBootstrapFromExecSql` pins the acknowledged founding heads, checking identity currency inside its transaction |
| `SwitchScope` | the host replaces the identity or database (`isIdentityCurrent`, `Database.client`, signing fingerprint) |
| `FinishPrime` | `createProvisionedPrincipalHistoryPrimer` captures the provisioning scope before any await, reads the founder's existing trust pin without writing, and passes that scope into every guarded progress write; its private batch memo is discarded |
| `Interrupt` | `savePrincipalHistoryStage` persists an incomplete page boundary |
| `StoreRejectedCurrent` | `acceptPage` saves a completed stage before `verifyPrincipalPolicyCurrent` checks its current artifacts |
| `BeginOperation` / `EndOperation` | a pass or workflow root mints a `createPrincipalPolicyOperation` token, and every `createRuntimePrincipalPolicyWarmer` given it shares the coordinator's batch for that token; a warmer without a token is its own operation. The batch is discarded with the token |
| `MemoUsable` | `reusableEntry` checks the hint epoch and producer lease before and after `directoryMemoValidity` pin coverage; `resolveReferencedPrincipalPolicy` always resolves through the warmer, so this is the only reuse of scoped evidence |
| `BeginReuse` | `memoPrincipalRecovery` rechecks `entryLive` synchronously and hands out the value with the consumer's and producer's lifetime |
| `ExpireProducer` | the producing call's `stillCurrent` (lease or caller lifetime) ends |
| `FinishReuse` / `CancelDerive` | `resolveReferencedPrincipalPolicy` registers the composite lifetime with `observeProjectionLifetime`, so `commitProjectionCheckpoints` cancels a use whose producer expired |
| `BeginCollect` | `memoPrincipalRecovery` observes the epoch before `recoverPolicyDirectory` runs `discoverDirectoryHead` |
| `BeginDerive` | `readMemoizedDirectory` and `readMemoizedAdmins` derive a citation from a reused entry and pass its epoch as `sourceEpoch` |
| `FinishCollect` | `readRecoveryPages` skips the read for a completed stage of the pinned head; `StoredPrincipalCurrentRejectedError` discards the stage and replays online; the entry is stored with the observed epoch |
| `AbortCollect` | `PrincipalHistoryRecoveryRaceError` when the durable pin changes during recovery |
| `FreshPerOperation` | the discovery read in `discoverDirectoryHead` runs once per operation; naming the held head (`ifVersion`, `ifStateHash`) only shrinks the reply, and an `unchanged` reply naming exactly that head selects the same pin |
| `NoStaleAfterHint` | `PrincipalPolicyCoordinator.recoveryEpoch` changes after a hint, so a collection that begins later rediscovers |
| `NoRollback` | the checkpoint reload in `finishRecovery` and admission's pin checks in `commitProjectionCheckpoints` |
| `ReuseCoversPin` | `directoryMemoValidity` reloads every named head's durable pin through `loadPrincipalPolicyCheckpoint` |
| `NoUseAfterProducerExpiry` | `createPrincipalRecoveryReader` collects every handed-out lifetime into the scoped recovery's `stillCurrent` |
| `PinCommitted` | provisioning pins and primes only after `provisioningAcknowledgedAccessHeads` accepts the response |
| `NoPrimeAfterScopeSwitch` | `savePrincipalHistoryStage` and prefix publication run `guardedTransaction` with the scope-bound `stillCurrent` |

Production is not atomic. A collection reads the server and local pins, then
stores its entry; a hint or pin change can land in between. The model splits
that into `BeginCollect` or `BeginDerive` and `FinishCollect`, and holds each
collection to the hint floor at which its reads began: one in flight when a
hint arrives may finish with its pre-hint view, but its stored entry carries
the pre-read epoch and is evicted before any later collection uses it. Reuse is
two steps as well: a value handed out to one collection may outlive its
producer, so the use checks the composite lifetime and is cancelled if the
producer expired. Admission also rechecks durable pins at the use.

The positive configuration explores three heads, three operations and two hints.
Ten negative controls in
[`scripts/protocol/protocolHistoryNegativeControls.ts`](../../scripts/protocol/protocolHistoryNegativeControls.ts)
disable one guard each:

- `DiscoverEachOperation = FALSE` (with hints disabled) violates
  `FreshPerOperation`: trusting the newest completed local head instead of
  discovering misses a revocation committed before the operation began.
- `ShortcutRequiresComplete = FALSE` violates `AcceptedHeadVerified`: skipping
  the read for partial progress accepts a head whose history was never checked.
- `ReplayRejectedStoredCurrent = FALSE` violates `HonestServerNeverRefused`: a
  completed stage holding rejected current artifacts would refuse the honest
  server forever, the bricked-device shape `NoBrickedDevice` forbids.
- `MemoPerOperation = FALSE` violates `FreshPerOperation`: a memo that outlives
  its operation serves a directory older than the next operation's start. A
  caller's shared policy cache must not become a second such memo:
  `principalRecoveryOperation.test.ts` shares one cache across two operations,
  across a hint, and past a named group pin.
- `EvictOnHint = FALSE` violates `NoStaleAfterHint`: a hinted advance would not
  reach later collections of an operation already in flight.
- `EvictOnCheckpoint = FALSE` violates `ReuseCoversPin`: another operation's
  newer durable pin would sit above the memoized directory, which admission
  would then refuse on every reuse. Production checks the
  organization pin and the pin of every group head the directory names; a pin
  advanced exactly to a memoized head keeps it, since the device admitted what
  the memo holds.
- `StampObservedEpoch = FALSE` violates `NoStaleAfterHint`: stamping an entry
  with the epoch current when it is stored, rather than the one observed before
  its reads (or its source's), lets a hint that arrived mid-collection go
  unnoticed by later collections. `principalRecoveryMemoHintRace.test.ts`
  reproduces this race.
- `CarryProducerLifetime = FALSE` violates `NoUseAfterProducerExpiry`: a value
  handed out under the consumer's lifetime alone stays usable after the
  collection that produced it expired.
  `principalRecoveryOperation.test.ts` and `principalRecoveryMemo.test.ts` expire
  the producer after hand-out and before the consumer's use.
- `PrimeRequiresAcknowledgement = FALSE` violates `PinCommitted`: priming a
  head the server never acknowledged pins the device past the honest server,
  whose own head every later collection then refuses as a rollback.
- `PrimeChecksScope = FALSE` violates `NoPrimeAfterScopeSwitch`: priming that
  binds its scope late writes progress (in production, it could pin a trust
  binding) for the replacement identity or database.
  `provisionedPrincipalHistoryScope.test.ts` switches both before and during
  priming and requires no durable row in either database.

Public projection sources follow the completed-stage rule: `readPublicPages`
skips its pinned read once progress is complete, and every read that does occur
checks the returned head artifacts against the private root. Hints are lossy,
so `FreshPerOperation` rests on the discovery read alone; hint eviction only
shortens reuse inside an operation. The model abstracts signatures, pages, the
public/private split, the producer lease, and concurrent recovery writers; the
signed SDK regressions in `principalHistoryRecovery.test.ts`,
`principalRecoveryMemo.test.ts`, `principalRecoveryOperation.test.ts`,
`principalRecoveryMemoHintRace.test.ts` and
`runtimeProjectionPolicyRecovery.test.ts` cover those boundaries. It does not
model the server's read authorization: dropping a confirmation read removes a
refusal of evidence the device already verified, and writes stay authorized
against live server state.

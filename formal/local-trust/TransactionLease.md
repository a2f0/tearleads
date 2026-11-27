# Transaction lease

[`TransactionLease.tla`](./TransactionLease.tla) checks the SQLite worker's
transaction lease (#3318). Every connection to a database in one worker shares
a single SQLite handle, so a transaction one tab opens is open for every tab
the owner worker serves. The lease makes the connection whose statement left
the handle inside a transaction its holder. Until that holder ends the
transaction, only its own statements run.

The model has two connections. H's tab opens transactions and may freeze (its
tab stays alive but sends nothing) or die (its liveness lock is gone). W's tab
stays alive and wants one statement run, sending it again after each refusal.
Time passes in ticks, and only while no statement can run. That matches the
worker, which runs every runnable statement as soon as it arrives, so its timer
only ever measures waiting.

| Model action or predicate | Production seam |
| --- | --- |
| `HIssue` / `WIssue` | `TransactionLease.submit` queues a statement; `transitionTransactionLease` moves the holder's `activeAt` when one of its statements arrives |
| `HRun` / `WRun` / `WMayRun` | `mayRunUnderTransactionLease` picks what `pump` runs; `runStatement` reads `isDatabaseInAutocommit` after each statement, which takes or frees the lease |
| `Tick` / `IdleBound` / `WaitBound` | the lease's timer, armed by `armTimer` for the nearest of `TRANSACTION_LEASE_IDLE_MS` and `TRANSACTION_LEASE_WAIT_MS` |
| `WRefuse` / `RefuseDrops` | `tick` refuses a waiter past the wait bound with `DATABASE_TRANSACTION_BUSY_MESSAGE` and removes it from `pending`, so it never runs |
| `Revoke` / `CanRevoke` / `IdleRevocation` | `tick` asks `transitionTransactionLease` whether a holder with no statement pending sat idle past the bound while another connection waits; `release` rolls it back, and `revokeConnection` logs it and retires the connection with `DATABASE_TRANSACTION_REVOKED_MESSAGE` |
| `HReopen` | `useWorkerCrashRecovery` reopens the database after the cross-tab client fails with `DatabaseTransactionRevokedError` |
| `Sweep` / `SweepDisconnect` | `sweepInactiveClients` calls `closeClient`, which sends the disconnect through `disconnectMessagePort`; `registerDatabaseWorkerPort` closes the connection, and `TransactionLease.close` rolls its transaction back |
| `HFreeze` / `HDie` | (boundary assumption) a tab stops sending without closing its port, or the browser discards it and releases its client lock (`createClientLivenessLock`) |
| `NoForeignStatementInTransaction` | `mayRunUnderTransactionLease` admits only the holder while the lease is held |
| `RetiredHolderKeepsNoLease` | `closeConnection` and `revokeConnection` end the connection's transaction through `release` |
| `RefusedStatementNeverRuns` | `refuse` removes the refused statements from `pending` before it rejects them |
| `WaiterRuns` | `retryWhileAnotherTabHoldsDatabase` at boot sends a refused statement again |

Bounds are two transactions for H with one statement inside each, an idle
bound of one tick and a wait bound of two. The idle bound is below the wait
bound, as `TRANSACTION_LEASE_IDLE_MS` is below `TRANSACTION_LEASE_WAIT_MS`, so
a stalled holder is revoked before a waiter behind it is refused. The model
does not cover SQL semantics: which statements open or end a transaction is
the autocommit flag that `isDatabaseInAutocommit` reads, and the worker tests
pin it for BEGIN, savepoints, failed batches, and `INSERT OR ROLLBACK`. Waiting
statements' order, the rollback that cannot end a transaction (the lease's
`failed` state), and deletes are left to the runtime tests.

`WaiterSettles` checks that every waiting statement runs or is refused, and
holds even without idle revocation. `WaiterRuns` checks that the retried
statement eventually runs. That needs weak fairness for the worker, the timer,
the sweep, and an alive holder's own work, which ends its transaction within
the bound. A holder that stays alive and active forever would refuse W
forever; the bound on H's work keeps that case out.

Negative controls remove one rule each:

- Without the lease (`UseLease`), W's statement runs inside H's transaction.
  That is the defect #3318 describes.
- Without the sweep's disconnect (`SweepDisconnect`), a dead tab's transaction
  holds the lease until another statement waits for the idle bound, and
  forever if none does. This breaks `DeadHolderReleased`.
- Without idle revocation (`IdleRevocation`), a frozen holder refuses W on
  every retry. This breaks `WaiterRuns`, though `WaiterSettles` still holds.
- If a refused statement stays queued (`RefuseDrops`), it runs after W was
  told it failed.

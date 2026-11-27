# @tearleads/sqlite-worker

The worker-thread runtime for client SQLite databases. It loads the
[SQLite WebAssembly build](../sqlite-instance/README.md), opens encrypted
databases in memory or in OPFS (through the SAH pool VFS), and serves
statements to a client over worker messages. When several browser tabs open
one database, a single owner tab runs the worker and the others reach it
through a broadcast channel. A client's open database lives only in the worker
that opened it. When ownership moves to another tab, the coordinator fails the
client with a `DatabaseConnectionLostError` crash, so the host can open a new
one: at once when this tab takes ownership, or when another tab's new owner
answers one of its statements
([`crossTabConnectionMachine.ts`](src/crossTabConnectionMachine.ts)). Until
then, a teardown it sends reaches a connection with nothing to close or delete.
The worker tells every other connection when one deletes their database, so a
deliberate delete is never reopened behind the tab that made it.

Hosts do not import this package directly: the
[client SDK](../client-sdk/README.md) wraps it as
`@tearleads/client-sdk/sqlite`, and
[SQLite setup for SDK hosts](../../docs/developer/sqlite-setup.md) describes
the host-facing contract. It may depend on `@tearleads/sqlite-instance` only.

## Entry points

| Entry point | Use for |
| --- | --- |
| `./runtime` | Create a dedicated, shared, or module database worker runtime |
| `./client` | `createDatabaseWorkerClient` and the `DatabaseWorkerClient` contract |
| `./types` | Request, response, cipher, and persistence types |
| `./worker` | `registerDatabaseWorker` for a worker entry module |
| `./worker-core` | Request handling without the worker registration |
| `./default-thread` | A ready-made worker entry module |
| `./load-sqlite3` | Load SQLite and open, close, or delete a database |
| `./purge-opfs-database` | Remove a database's OPFS storage |
| `./wipe-opfs-storage` | Remove everything in the origin's OPFS (device reset) |
| `./assets` | The default worker entry point URL |

## Transaction lease

Every connection to a database in one worker shares a single SQLite handle,
so a transaction one tab opens is open for every tab the owner worker serves.
The transaction lease keeps them apart
([`transactionLeaseMachine.ts`](src/transactionLeaseMachine.ts),
[`transactionLease.ts`](src/transactionLease.ts)). After each statement the
worker reads the handle's autocommit flag. A statement that leaves the handle
inside a transaction makes its connection the holder, and until one of the
holder's own statements ends that transaction, only the holder's statements
run. This covers every way a transaction starts or ends: BEGIN, a SAVEPOINT
outside a transaction, COMMIT, ROLLBACK, releasing the outermost savepoint,
and SQLite's own rollback after an error. Other connections' statements wait
in arrival order, and the holder's pass them.

Every wait has a bound:

- A statement that waits 5 s (`TRANSACTION_LEASE_WAIT_MS`) is refused with
  `DATABASE_TRANSACTION_BUSY_MESSAGE` and never runs. The client SDK's
  `isDatabaseTransactionBusyError` recognizes the refusal so callers retry it
  rather than treat it as a verdict on their work, and
  `retryWhileDatabaseBusy` runs refused work again up to five times. The
  app's boot runs a refused step again, retry paths keep refusals out of
  their failure budgets, and the paths that retry log them locally rather
  than reporting them.
- A holder idle for 3 s (`TRANSACTION_LEASE_IDLE_MS`) has its transaction
  rolled back once another connection's statement waits for it. Idle time
  counts from the later of the holder's last statement arriving and settling,
  whether or not anyone waited, so a holder already idle that long is rolled
  back as soon as a statement arrives behind it. The worker logs the
  database, how long the holder was idle, and how many statements waited, but
  never SQL text or bind values. It then retires the holder's connection:
  every statement it sends is answered `DATABASE_TRANSACTION_REVOKED_MESSAGE`
  until it opens the database again. The worker client rejects those with a
  `DatabaseTransactionRevokedError`, a kind of `DatabaseConnectionLostError`,
  and the cross-tab coordinator and a SharedWorker port also raise it to the
  runtime's worker-error listeners, so hosts reopen it the same way. The idle
  bound is below the wait bound, so a stalled holder is revoked before any
  statement waiting behind it is refused. A holder with a statement already
  waiting to run is never idle.
- A tab that closes or vanishes releases the lease. The owner's sweep sends
  the worker a disconnect for a client whose liveness lock is gone, and the
  worker closes that connection and rolls back its transaction.

If a forced rollback cannot leave the transaction, the worker closes the
database and every connection opens it again.
[`TransactionLease.tla`](../../formal/local-trust/TransactionLease.tla)
models the lease.

Persistence is opt-in: `persistence` defaults to `"memory"`, and
`"opfs-sahpool"` fails rather than falling back when OPFS is unavailable. The
[cipher suites](../../docs/cipher-suites.md#at-rest-database) reference lists
the codecs the worker accepts and the one the app selects.

## Tests

```sh
bun run --cwd packages/sqlite-worker test
```

The tests run the worker against an OPFS shim.
[`tests/fixtures`](tests/fixtures/) holds an
[encrypted database from an earlier runtime](tests/fixtures/README.md) that
every upgrade must still open; keep its bytes.

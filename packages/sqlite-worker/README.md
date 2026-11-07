# @tearleads/sqlite-worker

The worker-thread runtime for client SQLite databases. It loads the
[SQLite WebAssembly build](../sqlite-instance/README.md), opens encrypted
databases in memory or in OPFS (through the SAH pool VFS), and serves
statements to a client over worker messages. When several browser tabs open
one database, a single owner tab runs the worker and the others reach it
through a broadcast channel.

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
| `./assets` | The default worker entry point URL |

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

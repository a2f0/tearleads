# SQLite setup for SDK hosts

Hosts that own API routing, encrypted blob storage, keyring-derived
`localKeys` (see [Local Keyring](client-sdk/local-keyring.md#local-keyring)),
and logging can pass those adapters explicitly:

```ts
import {
  createEncryptedBlobStore,
  Tearleads,
} from "@tearleads/client-sdk";
import {
  createSQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";

const sqliteRuntime = createSQLiteRuntime();
await sqliteRuntime.client.init({
  dbName: "/app-identity.db",
  cipher: "chacha20",
  key: localKeys.sqliteKey,
  persistence: "opfs-sahpool",
});

const tearleads = new Tearleads({
  apiBaseUrl: "http://localhost:3000",
  blobStoreFactory: (namespace) =>
    createEncryptedBlobStore(namespace, { key: localKeys.blobStoreKey }),
  database: {
    client: sqliteRuntime.client,
    id: sqliteRuntime.id,
  },
  logger: {
    log: console.log,
    logError: console.error,
  },
});

const { rootContainerId } = await tearleads.identity.generate();
```

SQLite defaults to `"memory"`, which loses its database on worker restart or
page reload. This example explicitly uses
[durable OPFS storage](../cipher-suites.md#opfs-local-storage), requiring a
secure context. If OPFS is unavailable, initialization fails; it does not
silently fall back to memory. The host must retain the
[keyring](../glossary/keys.md#local-keyring) to reopen the
[encrypted database](../cipher-suites.md#at-rest-database).

Serve the worker and WASM assets as described in the
[SDK README](../../packages/client-sdk/README.md#quick-start). To initialize
SQLite after constructing the SDK, await `client.init(...)` first, then call
`tearleads.database.configure(...)` with the initialized runtime's `client` and
`id`.
See [database lifecycle](client-sdk/configuration.md#constructor-options) for initialization
and failure states.

A worker that serves several clients on one database, as the SDK's own worker
does for browser tabs, must keep each client's transaction to itself. One SQLite
handle holds one transaction at a time, so without that, one tab's statements
run inside another tab's transaction, and a rollback can undo them. The SDK's
worker does this with its
[transaction lease](../../packages/sqlite-worker/README.md#transaction-lease).
While another client holds a transaction, a statement waits up to 5 seconds.
If it is still waiting then, the worker refuses it without running it. A host
that supplies its own worker must give the same guarantee. A host that calls
the SDK's SQLite client directly should treat a refusal that
`isDatabaseTransactionBusyError` matches as a reason to retry, not a failure.
A client that sits idle in its transaction while another one waits is rolled
back and fails as a `DatabaseConnectionLostError`, which the host handles by
opening the database again.

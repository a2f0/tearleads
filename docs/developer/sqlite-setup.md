# SQLite setup for SDK hosts

Hosts that own API routing, encrypted blob storage, keyring-derived
`localKeys` (see [Local Keyring](client-sdk.md#local-keyring)), and logging can
pass those adapters explicitly:

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
page reload. This example explicitly uses durable OPFS storage, requiring a
secure context. If OPFS is unavailable, initialization fails; it does not
silently fall back to memory. The host must retain the keyring to reopen the
encrypted database.

Serve the worker and WASM assets as described in the
[SDK README](../../packages/client-sdk/README.md#quick-start). To initialize
SQLite after constructing the SDK, await `client.init(...)` first, then call
`tearleads.database.configure(...)` with the initialized runtime's `client` and
`id`.
See [database lifecycle](client-sdk.md#constructor-options) for initialization
and failure states.

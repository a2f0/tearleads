# Initializing the client SDK

Initialize the host database, configure the SDK, then create or restore the
identity. Examples assume the public `@tearleads/client-sdk` and
`@tearleads/client-sdk/sqlite` entry points from the [SDK guide](client-sdk.md).

## SQLite and runtime lifecycle

`new Tearleads(...)` does not initialize SQLite or call `client.init(...)`. The
constructor only captures the database `client`, `execSql`, and `id` and
derives the status from them; `TearleadsDatabaseOptions` takes no `status`. If
the worker is already initialized, pass the runtime in; the SDK infers
`status: "ready"`:

```ts
new Tearleads({
  database: { client: runtime.client, id: runtime.id },
});
```

If the host boots SQLite after constructing the SDK, create `new Tearleads(...)`
without a ready database, call `runtime.client.init(...)`, then publish the
initialized runtime with `tearleads.database.configure({ client, id })`.

Pass `status` to `tearleads.database.configure(...)` only for lifecycle states
the SDK cannot infer from the presence of a client, such as a worker that
exists but is still initializing (`"idle"`) or a failed initialization
(`"error"`). Publish a destroyed runtime with
`tearleads.database.clear("terminated")`.

Browser and Electron hosts create worker-backed SQLite runtimes with
`createSQLiteRuntime()` from `@tearleads/client-sdk/sqlite`.
`SQLiteRuntime` is the host lifecycle object with required `id`, `client`,
`destroy()`, `deleteData()`, and `terminateNow()` members. It also has optional
`renewClient()` and `subscribeWorkerError(listener)` methods. Use the exported
type when implementing a host adapter; the factories provide these methods
according to their worker capabilities. The runtime starts its worker from
`/worker.js` unless `workerUrl`
names another URL. The host serves the SDK's `sqlite/worker.js` there, with
`sqlite/sqlite3.wasm` beside it (the worker loads it from its own URL), and
ships `sqlite/sqlite3-licenses.md` with both. Every Tearleads host copies these
exports, so npm consumers run the same worker the apps do.

The SQLite facade exposes lower-level database runtime capabilities through SDK
SQLite vocabulary:

| SDK export | Use for |
| --- | --- |
| `createSQLiteRuntime(options?)` | Creating the default module-worker runtime, optionally with `workerUrl` or a custom `workerConstructor` |
| `createSQLiteRuntimeFromWorker(worker)` | Wrapping a host-created terminable worker-like object |
| `SQLiteRuntime` | The lifecycle contract described above, returned by both runtime factories |
| `SQLiteWorkerClient` | The worker client contract accepted by `database.client` through `ExecSqlClientLike` |
| `CreateSQLiteRuntimeOptions`, `SQLiteModuleWorkerConstructor`, `SQLiteModuleWorkerLike` | Host adapter types for custom module-worker construction |
| `getSQLitePersistenceRuntime(execSql)` | Building typed Drizzle queries against the active SDK SQLite executor |
| `defineSqlTableSchema(table)` | Rendering app-owned Drizzle SQLite table definitions for `ensureSqlTables` |
| `ExecSql`, `SqlTableSchema`, `ensureSqlTables`, `runSerializedSqlMutation` | Explicit executor, schema, and mutation helpers for host-owned persistence edges |
| `resetConnectionSchemaMemo(execSql)` | Forgetting the connection's completed schema-ensure memo after a host operation rebuilds tables out from under the runtime (local backup restore) |

Host runtime code should use this facade instead of importing
`createDatabaseRuntime`, `createModuleDatabaseRuntime`, `DatabaseRuntime`, or
`DatabaseWorkerClient` from `@tearleads/sqlite-worker` directly. Low-level
SQLite tests import the underlying worker package to exercise the
worker itself.

`destroy()` closes the connection gracefully and preserves its data.
`deleteData()` deletes the persisted database and terminates its worker, even
if deletion fails. `terminateNow()` terminates synchronously for page-unload
handlers. Optional `renewClient()` replaces the client and ID on the same
worker; `subscribeWorkerError()` observes worker crashes and returns an
unsubscribe function. See the [underlying runtime contract](../../packages/sqlite-worker/src/runtime.ts)
for the exact signatures.

## Identity and local root setup

Identity setup is asynchronous because the signing fingerprint is derived from
the public key and local root setup requires SQLite. `generate()` requires a
ready SQLite database, creates or reuses the local root container, and stores it
on `tearleads.session.containerId` before resolving with `rootContainerId`,
`rootContainerCreated`, `seedPhrase`, and `userId`.

The root belongs to the local database. A new identity that needs a fresh root
must use a fresh database; generation reuses an existing local root and reports
`rootContainerCreated: false`. This local result is distinct from
`tearleads.runtime.input().auth.rootContainerId`, which requires a
server-acknowledged session root. Server registration also requires
`database.client`; an executor alone supports local generation but cannot
register the identity.

Generation checks SQLite readiness, prepares identity-scoped blob storage,
and then bootstraps the root. A synchronous blob factory failure rejects before
creating or selecting a root. If preparation or root bootstrap fails, the
previous identity and active blob store stay in place and identity subscribers
are not notified. Correct the unavailable prerequisite and retry. A custom
factory should return a usable store or throw; preparing it must not depend on
the new identity already being published.

Starting another identity mutation (including clearing keys or `destroy()`)
supersedes pending generation/import/key-setting calls, even if the newer import
later fails validation. Superseded calls reject
instead of restoring old keys; a superseded fingerprint refresh returns the
current fingerprint. An explicit blob namespace change during root bootstrap
also cancels generation. Fingerprint refresh observes the current identity and
does not cancel a pending import or generation. A generation call rejected
because SQLite is not ready does not cancel a pending import.
A cancelled bootstrap may have persisted a reusable local root. Cancellation
before root selection prevents selecting it; cancellation after selection
leaves that database-local root selected, but does not publish the generated
keys. Destroying an identity does not clear its database's local root.
Direct callers of `session.bootstrapLocalRootContainer(isCurrent?)` can supply
the same currency predicate to prevent a superseded call selecting its root.

The `Tearleads` constructor stays synchronous, so constructor-provided identity
key pairs are available through
`tearleads.identity.snapshot`, but callers should use
`refreshSigningFingerprint()` or `setKeyPairs(...)` when they need the derived
fingerprint asynchronously.

Generated identities are seed-backed: `generate()` creates a 24-word BIP39
English phrase on the result/snapshot. `importSeedPhrase(...)` regenerates the
key pairs; session/container recovery is host-owned.

`identityProvisioning` defaults to `"manual"`. Set it to `"auto"` to provision
a single-identity SDK instance once SQLite is available. It schedules
`identity.generate()` when the database
is ready and no signing key pair exists, and does not initialize SQLite, replace
an existing signing key, block the constructor, or provision again after a
successful automatic provisioning.
Choose either automatic provisioning or an explicitly awaited `generate()`;
do not start both for the same instance.
An import or `destroy()` can supersede automatic provisioning. The automatic
task reports that rejection through `logError("Automatic identity provisioning
failed")`; it retries only after another database change, provided no signing
key exists. Hosts intentionally cancelling setup can handle that log outcome
and explicitly generate when ready.

## Blob storage and non-browser hosts

When an identity fingerprint is available, the default blob store switches from
an ephemeral memory store to the identity-scoped store returned by
`createBlobStore(signingFingerprint)`. Hosts that need a custom blob backend
pass a fixed `blobStore`, or `blobStoreFactory` for identity-scoped stores, at
construction. The default and factory-backed stores still switch namespaces
automatically with identity (and via
`useEphemeralStore`/`useIdentityNamespace`); a fixed `blobStore` is used as
given until the host explicitly switches namespaces.

`blobs.updateIdentityNamespace(fingerprint)` follows identity storage policy:
it preserves a fixed host store, selects an identity-scoped store otherwise,
and returns to ephemeral storage for `null`. `useIdentityNamespace` explicitly
opts into an identity namespace even when a fixed store was supplied;
`useEphemeralStore` explicitly selects anonymous storage. Finish or cancel
pending identity setup before making these explicit host switches.

For browser and Electron hosts, prefer an encrypted local blob store factory:

```ts
new Tearleads({
  blobStoreFactory: (namespace) =>
    createEncryptedBlobStore(namespace, { key: localKeys.blobStoreKey }),
});
```

The example uses a `LocalKeyringSession`-derived key; hosts can pass any
supported key type directly, or use
`createLazyEncryptedBlobStore(namespace, keyProvider)` to defer async keyring
loading and retry transient load failures.

`createEncryptedBlobStore(namespace, options)` requires OPFS and stores
authenticated 5 MiB chunks. String keys use PBKDF2-SHA256; raw 32-byte and
AES-GCM keys are supported. Ranged methods provide bounded-memory I/O. Store
factories throw without OPFS; tests and hosts can explicitly opt into ephemeral
`createMemoryBlobStore()` storage.

A host without OPFS can supply `blobStoreFactory: () => createMemoryBlobStore()`
for disposable blobs, or a durable host-owned factory. The initial anonymous
memory store does not make the default identity-scoped backend portable to
Node or other non-browser hosts. Supply an initialized SQLite client with
`database: { client, id }`; use `apiBaseUrl` or `identityTrustDomain` as described
in [identity trust](trusted-user-identity.md) before contacting an API. Persist
the generated seed phrase or exported key package securely, and tear down the
SDK with `dispose()` before destroying the host-owned runtime.

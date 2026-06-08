# Client SDK

`@tearleads/client-sdk` is the React-free client runtime package. It owns local
SQLite execution, identity key state, blob storage, and workflow runtime
composition. React providers, browser workers, Electron wrappers, and UI stores
should adapt host-specific behavior into this package rather than duplicating
SDK setup.

## Quick Start

Create one SDK instance for the active client environment:

```ts
import {
  createEncryptedBlobStore,
  createLocalKeyring,
  createMemoryLocalKeyringManifestStore,
  createMemoryWrappingKeyKeystore,
  Tearleads,
} from "@tearleads/client-sdk";
import {
  createModuleSQLiteRuntime,
  type SQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";

const sqliteRuntime: SQLiteRuntime = createModuleSQLiteRuntime();
const localKeyring = createLocalKeyring({
  // Development only. Production hosts should provide a platform keystore and
  // persisted manifest store.
  keystore: createMemoryWrappingKeyKeystore(),
  manifestStore: createMemoryLocalKeyringManifestStore(),
});
const localKeys = await localKeyring.getOrCreateSession({
  namespace: "development",
});
await sqliteRuntime.client.init({
  dbName: "/app-identity.db",
  cipher: "chacha20",
  key: localKeys.sqliteKey,
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

const identity = await tearleads.identity.generate();
const rootContainerId = identity.rootContainerId;

if (!rootContainerId) {
  throw new Error("SQLite must be ready before local root setup can complete.");
}

const document = tearleads.documents.open({
  containerId: rootContainerId,
  initialText: "Draft note",
  localId: "draft-note",
});
await document.ensureInitialized();
await document.setText("Updated note text");

const localNotes = await tearleads.documents.listLocal({
  limit: 50,
  offset: 0,
  sort: { direction: "desc", key: "updated" },
});

const containerTree = tearleads.containerContents.openTree();
await containerTree.refresh();

const firstContainerPage =
  await tearleads.containerContents.documentQueries().listContainerItemWindow({
    containerId: rootContainerId,
    limit: 50,
    offset: 0,
    sort: { direction: "asc", key: "name" },
  });
```

The instance intentionally groups client capabilities by responsibility:

| Namespace | Owns |
| --- | --- |
| `tearleads.database` | SQLite client and `ExecSql` executor |
| `tearleads.identity` | signing and encapsulation key pairs |
| `tearleads.blobs` | local blob byte storage |
| `tearleads.session` | registration, auth token, and user/org/container context |
| `tearleads.network` | online/offline state passed into sync workflows |
| `tearleads.events` | remote event list passed into sync workflows |
| `tearleads.runtime` | workflow runtime input snapshots for host stores and providers |
| `tearleads.documents` | opening one editable document, paged local document lists, local document deletion, document subscriptions, and document workflow runtime composition |
| `tearleads.containerContents` | the container tree store, container document query helpers, document-link operations, discovery, diagnostics, and workflow runtime composition |
| `tearleads.organizations` | organization administration and directory operations |
| `tearleads.userKeys` | verified user key lookup for product queries and recipient UIs |

Prefer these instance services over constructing workflow runtimes directly
from host code. The SDK keeps workflow cache scope aligned with the active
database id and identity fingerprint, which lets document and
container/document stores share the same sync and subscription boundary.
Product app code should prefer the instance surface:
`tearleads.documents.open(...)`, `tearleads.documents.listLocal(...)`,
`tearleads.documents.subscribeToLocal(listener, { containerId })`,
`tearleads.containerContents.openTree()`, and
`tearleads.containerContents.documentQueries()`. Import lower-level store and
workflow packages only when writing SDK internals or custom host integrations.

Host adapters that still need the raw workflow runtime contract should use
`tearleads.runtime.input(containerId)` instead of reconstructing the dependency
bundle themselves. This host-facing runtime input intentionally does not expose
the raw API client; SDK namespaces and workflow facades own HTTP transport
access.

Runtime input snapshots are grouped by capability:

| Group | Fields |
| --- | --- |
| `auth` | `userId`, `organizationId`, `isAuthenticated` |
| `crypto` | `signingKeyPair`, `signingFingerprint`, `encapsulationKeyPair` |
| `infra` | `dbStatus`, `execSql`, `blobStore`, `documentProjectors` |
| `state` | `containerId`, `domainScope`, `events`, `online` |
| `util` | `log`, `logError`, `cacheReferencedPrincipalPolicies` |

Host and workflow integration code should use these grouped fields so a
consumer's dependency boundary is visible. Runtime snapshots expose grouped
capabilities only.

`tearleads.containerContents.workflowRuntime()` creates the lower-level
container-contents workflow runtime for advanced host stores and custom
workflows. It packages the current API client, auth/session ids, identity keys,
SQLite/blob infrastructure, current container id, domain scope, events, online
state, and SDK utility callbacks into the shape expected by
`workflows/container-contents`. Most product code should use the higher-level
container contents methods instead: `openTree()`, `documentQueries()`,
`documentLinks()`, `discoverContainerDocuments(...)`,
`refreshAllContainerDocuments()`, and the diagnostic loaders.

## Constructor Options

`new Tearleads(options)` accepts host adapters and initial runtime state:

```ts
const tearleads = new Tearleads({
  apiBaseUrl,
  blobStore,
  blobStoreFactory,
  database,
  documentProjectors,
  events,
  identity,
  logger,
  online,
});
```

`documentProjectors` may be either a prebuilt `DocumentProjectorRegistry` or a
readonly array of `DocumentProjectorDefinition` values. Prefer passing
definitions when integrating an app-owned document type list; the SDK will
normalize and cache the registry internally.

Use `apiBaseUrl` for the SDK-managed HTTP transport. The raw API client is
internal SDK wiring, not a public instance namespace for host code.
Use `database.client` for a SQLite worker client that implements
`ExecSqlClientLike`; the SDK creates the canonical `ExecSql` adapter from it.
Use `database.execSql` only when the host already owns executor construction.

`new Tearleads(...)` does not initialize SQLite or call `client.init(...)`; the
constructor stays synchronous and only captures the current database `client`,
`execSql`, and `id`, deriving status unless the host supplies an explicit
lifecycle override. If the host has already initialized the worker, pass the
runtime into the constructor; the SDK infers `status: "ready"` from the
configured client or executor:

```ts
new Tearleads({
  database: { client: runtime.client, id: runtime.id },
});
```

If the host boots SQLite after constructing the SDK, create `new Tearleads(...)`
without a ready database, call `runtime.client.init(...)`, then publish the
initialized runtime:

```ts
tearleads.database.configure({
  client: runtime.client,
  id: runtime.id,
});
```

Pass `status` to `tearleads.database.configure(...)` only for lifecycle states
the SDK cannot infer from the presence of a client, such as a worker that
exists but is still initializing (`"idle"`) or a failed initialization
(`"error"`). Publish a destroyed runtime with
`tearleads.database.clear("terminated")`.

Browser and Electron hosts should create worker-backed SQLite runtimes through
the SDK SQLite facade:

```ts
import { createModuleSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
```

`SQLiteRuntime` is the host lifecycle object with `{ id, client,
destroy() }`. The lower-level `@tearleads/sqlite-worker` package still owns the
worker thread implementation, but host application code should prefer the SDK
facade so database setup, executor contracts, and workflow runtime integration
stay behind one developer-facing package.

The SQLite facade intentionally aliases the lower-level database runtime names
into SDK SQLite vocabulary:

| SDK export | Use for |
| --- | --- |
| `createModuleSQLiteRuntime(options?)` | Creating the default module-worker runtime, optionally with `workerUrl` or a custom `workerConstructor` |
| `createSQLiteRuntime(worker)` | Wrapping a host-created terminable worker-like object |
| `SQLiteRuntime` | The `{ id, client, destroy() }` lifecycle contract returned by both runtime factories |
| `SQLiteWorkerClient` | The worker client contract accepted by `database.client` through `ExecSqlClientLike` |
| `CreateModuleSQLiteRuntimeOptions`, `SQLiteModuleWorkerConstructor`, `SQLiteModuleWorkerLike` | Host adapter types for custom module-worker construction |
| `getSQLitePersistenceRuntime(execSql)` | Building typed Drizzle queries against the active SDK SQLite executor |
| `defineSqlTableSchema(table)` | Rendering app-owned Drizzle SQLite table definitions for `ensureSqlTables` |
| `ExecSql`, `SqlTableSchema`, `ensureSqlTables`, `runSerializedSqlMutation` | Explicit executor, schema, and mutation helpers for host-owned persistence edges |

Host runtime code should use these aliases instead of importing
`createDatabaseRuntime`, `createModuleDatabaseRuntime`, `DatabaseRuntime`, or
`DatabaseWorkerClient` from `@tearleads/sqlite-worker` directly. Worker-thread
entry files and low-level SQLite tests may still import the underlying worker
package when they are implementing or exercising the worker itself.

Identity setup is asynchronous because the signing fingerprint is derived from
the public key. When SQLite is already configured, `generate()` also creates or
reuses the local root container and stores it on `tearleads.session.containerId`:

```ts
const identity = await tearleads.identity.generate();

identity.signingKeyPair;
identity.encapsulationKeyPair;
identity.signingFingerprint;
identity.rootContainerId;
identity.userId; // null until registration or login establishes a user

await tearleads.identity.setKeyPairs({
  signingKeyPair,
  encapsulationKeyPair,
});
```

If SQLite is not ready when `generate()` runs, `rootContainerId` and
`rootContainerCreated` are `null`; configure the database and then call
`tearleads.session.bootstrapLocalRootContainer()`. The `Tearleads` constructor
stays synchronous, so constructor-provided identity key pairs are available
through `tearleads.identity.snapshot`, but callers should use
`refreshSigningFingerprint()` or `setKeyPairs(...)` when they need the derived
fingerprint asynchronously.

When an identity fingerprint is available, the default blob store switches from
an ephemeral memory store to the identity-scoped store returned by
`createBlobStore(signingFingerprint)`. Hosts that need a custom blob backend can
pass a fixed `blobStore`, pass `blobStoreFactory` for identity-scoped stores, or
call `tearleads.blobs.setStore(store)`.

For browser and Electron hosts, prefer an encrypted local blob store factory:

```ts
new Tearleads({
  blobStoreFactory: (namespace) =>
    createEncryptedBlobStore(namespace, { key: localKeys.blobStoreKey }),
});
```

The example uses a `LocalKeyringSession`-derived key; hosts can also pass any
supported key type directly.

`createEncryptedBlobStore(namespace, options)` stores local attachment bytes in
OPFS when available and falls back to encrypted memory storage otherwise. The
OPFS-specific `createEncryptedOpfsBlobStore(namespace, options)` throws when
OPFS is unavailable. The encrypted store currently supports `aes-256-gcm`.
String keys are derived with PBKDF2-SHA256; hosts may also pass a 32-byte raw
AES key or an AES-GCM `CryptoKey`.

## Local Keyring

The SDK exports a local keyring helper for host-controlled at-rest secret
management:

```ts
import {
  createBrowserLocalKeyring,
  createLocalKeyring,
} from "@tearleads/client-sdk";

const keyring = createLocalKeyring({
  keystore: platformWrappingKeyKeystore,
  manifestStore: persistedManifestStore,
});

const session = await keyring.getOrCreateSession({
  namespace: "tearleads",
  accountId: userId,
  signingFingerprint,
});
```

Browser hosts can use the built-in durable wiring:

```ts
const keyring = createBrowserLocalKeyring();
```

`createBrowserLocalKeyring()` stores the JSON manifest in `localStorage` and
stores the wrapping-key handle as a non-extractable AES-GCM `CryptoKey` in
IndexedDB. The wrapped account-root secret and the browser `CryptoKey` survive
same-origin app restarts; `keyring.deleteSession(scope)` removes both. Hosts
that need custom storage can use `createIndexedDbWrappingKeyKeystore(...)` and
`createLocalStorageLocalKeyringManifestStore(...)` separately.

`WrappingKeyKeystore` is the platform boundary. Browser, Electron, iOS, and
Android hosts should implement it with their available keychain or secure
storage primitive. The SDK stores only a manifest containing a wrapped
account-root secret; the unwrapped account root is used with HKDF to derive:

- `session.sqliteKey` for SQLCipher/SQLite initialization
- `session.blobStoreKey` for encrypted local blob storage
- `session.identityPersistenceKey` for persisted identity-key material
- additional 32-byte keys through `session.deriveKey(purpose)`

The manifest is explicit JSON with format
`tearleads.local-keyring.manifest`. Hosts persist it through
`LocalKeyringManifestStore`, and can serialize or parse it with
`serializeLocalKeyringManifest(...)` and `parseLocalKeyringManifest(...)`.
The wrapped root envelope uses format `tearleads.wrapped-local-secret` and
binds the wrapping context to the normalized scope plus key purpose.

Scopes are intentionally part of derivation and wrapping associated data:
`namespace` is required, while `accountId` and `signingFingerprint` are optional
isolation fields. `localKeyringScopeKey(scope)` provides the canonical storage
key when a manifest store needs a stable index.

`createMemoryWrappingKeyKeystore()` and
`createMemoryLocalKeyringManifestStore()` are process-local helpers for tests
and development wiring. They are not a durable or platform-secure keychain.
The browser IndexedDB helper is durable, but it is still origin-bound browser
storage: same-origin code can ask the stored `CryptoKey` to unwrap the local
secret even though it cannot export the key bytes. Hosts that require explicit
user unlock should provide a `WrappingKeyKeystore` backed by their chosen
PIN/passphrase, WebAuthn, OS keychain, or secure enclave flow.
Call `session.dispose()` when a host is done with a local keyring session; it
zeroes the in-memory root and derived byte keys owned by that session.
`keyring.deleteSession(scope)` removes both the manifest and the wrapping-key
handle for the scope.

Session state is explicit. Registration flows should call
`tearleads.session.registerIdentity()`, which submits the current identity,
persists the local bootstrap, and updates the session with canonical user,
organization, and container IDs. Login stores the auth token on
`tearleads.session` and configures the internal API client:

```ts
const registration = await tearleads.session.registerIdentity();
if (registration) {
  const authenticated = await tearleads.session.login(registration.challenge);
}
```

## Public API Entry Points

Supported package entry points are:

| Entry point | Use for |
| --- | --- |
| `@tearleads/client-sdk` | `Tearleads`, top-level SDK service types, local keyring helpers, document contracts, store facades, and workflow facade symbols that remain public |
| `@tearleads/client-sdk/sqlite` | SQLite worker runtime factory, executor contracts, and adapter helpers |

Each package export maps `types` to an emitted `.d.ts` file and `default` to an
emitted ESM JavaScript file under `dist`. Keep the export map exact; adding a
new public subpath is a package API expansion and needs an explicit migration
plan, documentation, and architecture-lint coverage.

Do not import `@tearleads/client-sdk/data/*` from host code. Promote a contract
through the root entry point when it is meant to become public.

## Entrypoint Consolidation Migration

Issue #750 reduced the public package import surface to the root SDK entry
point plus the SQLite runtime facade:

| Entry point | Target use |
| --- | --- |
| `@tearleads/client-sdk` | SDK instance, public service types, local keyring helpers, document contracts, store facades, and workflow facade symbols that remain public |
| `@tearleads/client-sdk/sqlite` | SQLite worker runtime and executor contracts |

The deprecated document, store, and workflow subpaths are no longer package
exports. New host-code imports should use the root entry point for document
contracts, store facades, and workflow facade symbols. Keep
`@tearleads/client-sdk/sqlite` separate because it is the SQLite runtime
adapter boundary.

The root entry point aggregates documented public facades. This does not make
`data/*` internals public, and it should not be used to expose deep workflow or
store implementation files. If package-level test helpers become necessary,
add a dedicated `@tearleads/client-sdk/testing` entry point with the same
explicit documentation and lint treatment as any other package API addition.

When a lower-level workflow facade name conflicts with an existing root service
type, keep the existing root meaning stable and add an explicit migration alias.
For example, root `ContainerDocumentLinkInput` remains the high-level client
document-link input, while the lower-level container query link input is
available as `ContainerDocumentQueriesLinkInput`.

## Package Status

The package remains `private: true` for now. It has an explicit build contract
for monorepo package consumption and publish rehearsal:

```sh
bun run --filter='@tearleads/client-sdk' build
```

The build removes the previous `dist` and emits ESM JavaScript, inline-source
source maps, and declaration files from `tsconfig.build.json`.

Before removing `private: true`, confirm all runtime dependencies are either
published packages or intentionally declared peer dependencies, replace
workspace-only dependency ranges with publishable ranges, and run a package
dry-run against the built `dist` contents.

`bun run lint:architecture` enforces the current package-consumption contract:

- `@tearleads/client-sdk` stays private, ESM, side-effect-free, and backed by
  build-output package exports until a release decision is made.
- Local `@tearleads/*` package dependencies stay on `workspace:*` ranges while
  the SDK remains private inside the monorepo.
- The package export map matches the documented root and SQLite entry points
  exactly, points at `dist` JavaScript/declaration files, and keeps the public
  API entry-point table in sync with it.
- `data/*`, document, store, workflow, and deep implementation package exports
  are rejected.
- Production app code uses SDK root service surfaces instead of importing SDK
  document, workflow, or store package facades directly.
- Product window vocabulary such as `OrgManager` and `mini-app` stays in
  `packages/app`; SDK source should use platform workflow names.

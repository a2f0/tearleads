# Client SDK

`@tearleads/client-sdk` is the React-free client runtime package. It owns local
SQLite execution, identity key state, blob storage, and workflow runtime
composition. React providers, browser workers, Electron wrappers, and UI stores
should adapt host-specific behavior into this package rather than duplicating
SDK setup.

## Quick Start

Create one SDK instance for the active client environment:

```ts
import { Tearleads } from "@tearleads/client-sdk";
import {
  createModuleSQLiteRuntime,
  type SQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";

const sqliteRuntime: SQLiteRuntime = createModuleSQLiteRuntime();
await sqliteRuntime.client.init({
  dbName: "/app-identity.db",
  cipher: "chacha20",
  key: "development-key", // For development only. Do not use in production.
});

const tearleads = new Tearleads({
  apiBaseUrl: "http://localhost:3000",
  database: {
    client: sqliteRuntime.client,
    id: sqliteRuntime.id,
    status: "ready",
  },
  logger: {
    log: console.log,
    logError: console.error,
  },
});

await tearleads.identity.generate();
await tearleads.session.bootstrapLocalRootContainer();

const containerContents = tearleads.containerContents.runtime();
const documents = tearleads.documents.runtime({
  containerId: tearleads.session.containerId,
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
| `tearleads.documents` | document workflow runtime composition |
| `tearleads.containerContents` | container contents workflow runtime composition |
| `tearleads.contacts` | contacts workflow runtime composition |
| `tearleads.organizations` | organization administration and directory operations |

Prefer these instance services over constructing workflow runtimes directly
from host code. The SDK keeps workflow cache scope aligned with the active
database id and identity fingerprint, which lets document, contacts, and
container/document stores share the same sync and subscription boundary.

Host adapters that still need the raw workflow runtime contract should use
`tearleads.runtime.input(containerId)` instead of reconstructing the dependency
bundle themselves. This host-facing runtime input intentionally does not expose
the raw API client; SDK namespaces and workflow facades own HTTP transport
access.

## Workflow Facade Taxonomy

SDK workflow facades expose client platform capabilities. Product UI, route
state, menu labels, component-local hooks, and React providers stay in
`packages/app`.

| Facade | Classification | Boundary |
| --- | --- | --- |
| `workflows/documents`, `workflows/blobs`, `workflows/containers`, `workflows/principals`, `workflows/registration`, `workflows/sync` | Platform runtime | Protocol-facing client operations, local persistence orchestration, sync coordination, key verification, and registration bootstrap helpers |
| `workflows/container-contents` | Platform read model and runtime | Container tree state, container metadata documents, document link/discovery read models, and container contents sync helpers. The container-contents store facade adapts these into UI state without React. |
| `workflows/contacts` | Platform read model and runtime | Local address-book documents and key lookup helpers used by contacts sync and recipient selection without owning Contacts UI interactions |
| `workflows/organizations` | Platform organization administration | Organization directory, groups, grants, usage, user-detail read models, and principal-policy mutation helpers; the Org Manager mini-app adapts these into product screens in `packages/app` |

When a workflow exists mainly to support a product screen, keep its name tied to
the platform state it exposes rather than to the app window that consumes it.
The SDK should export `workflows/organizations`, for example, while the app may
continue to call its React provider and components `OrgManager`.

## Constructor Options

`new Tearleads(options)` accepts host adapters and initial runtime state:

```ts
const tearleads = new Tearleads({
  apiBaseUrl,
  apiClient,
  blobStore,
  database,
  documentProjectors,
  events,
  identity,
  logger,
  online,
});
```

Use `apiBaseUrl` for the SDK-managed HTTP transport, or pass an existing
`apiClient` for host integration and tests. The raw API client is internal SDK
wiring, not a public instance namespace for host code.
Use `database.client` for a SQLite worker client that implements
`ExecSqlClientLike`; the SDK creates the canonical `ExecSql` adapter from it.
Use `database.execSql` only when the host already owns executor construction.

`new Tearleads(...)` does not initialize SQLite or call `client.init(...)`; the
constructor stays synchronous and only captures the current database `client`,
`execSql`, `id`, and `status`. If the host has already initialized the worker,
pass a ready database into the constructor:

```ts
new Tearleads({
  database: { client: runtime.client, id: runtime.id, status: "ready" },
});
```

If the host boots SQLite after constructing the SDK, create `new Tearleads(...)`
without a ready database, call `runtime.client.init(...)`, then publish the
initialized runtime:

```ts
tearleads.database.configure({
  client: runtime.client,
  id: runtime.id,
  status: "ready",
});
```

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

Host runtime code should use these aliases instead of importing
`createDatabaseRuntime`, `createModuleDatabaseRuntime`, `DatabaseRuntime`, or
`DatabaseWorkerClient` from `@tearleads/sqlite-worker` directly. Worker-thread
entry files and low-level SQLite tests may still import the underlying worker
package when they are implementing or exercising the worker itself.

Identity setup is asynchronous because the signing fingerprint is derived from
the public key:

```ts
await tearleads.identity.generate();

await tearleads.identity.setKeyPairs({
  signingKeyPair,
  encapsulationKeyPair,
});
```

When an identity fingerprint is available, the default blob store switches from
an ephemeral memory store to the identity-scoped store returned by
`createBlobStore(signingFingerprint)`. Hosts that need a custom blob backend can
pass `blobStore` or call `tearleads.blobs.setStore(store)`.

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
| `@tearleads/client-sdk` | `Tearleads` and top-level SDK service types |
| `@tearleads/client-sdk/documents` | neutral document/blob contracts and document projector helpers |
| `@tearleads/client-sdk/sqlite` | SQLite worker runtime factory, executor contracts, and adapter helpers |
| `@tearleads/client-sdk/stores/contacts` | React-free contacts store facade |
| `@tearleads/client-sdk/stores/container-contents` | React-free container tree store facade |
| `@tearleads/client-sdk/stores/documents` | React-free document store facade |
| `@tearleads/client-sdk/workflows/blobs` | blob upload, hydration, and local blob stores |
| `@tearleads/client-sdk/workflows/contacts` | contacts runtime and read/write helpers |
| `@tearleads/client-sdk/workflows/containers` | container mutation planning and remote container operations |
| `@tearleads/client-sdk/workflows/documents` | document creation, sync, persistence, and projection-key helpers |
| `@tearleads/client-sdk/workflows/container-contents` | container contents read models, document-link helpers, and sync helpers |
| `@tearleads/client-sdk/workflows/organizations` | organization administration read models and principal-policy helpers |
| `@tearleads/client-sdk/workflows/principals` | principal policy cache helpers |
| `@tearleads/client-sdk/workflows/registration` | local registration/root bootstrap helpers |
| `@tearleads/client-sdk/workflows/sync` | shared sync coordinator helpers |

Each package export maps both `types` and `default` to the same source entry
point. This is the current monorepo package contract: consumers compile the SDK
TypeScript source through the workspace dependency rather than consuming emitted
artifacts. Keep the export map exact; adding a new public subpath should mean
adding a documented root, store, or workflow facade entry point.

Do not import `@tearleads/client-sdk/data/*` from host code. Promote a contract
through the root or a workflow/store facade when it is meant to become public.

## Package Status

The package remains `private: true` for now. It is ready for monorepo package
consumption through explicit root, store, and workflow entry points, but not yet
ready for an external npm release because package exports still point at source
files, type targets are source files rather than emitted `.d.ts` files, and the
workspace dependencies do not have a release/build contract.

Before removing `private: true`, add a release build that emits JavaScript and
`.d.ts` files, switch package exports to the build output, and confirm all
runtime dependencies are either published packages or intentionally declared peer
dependencies.

`bun run lint:architecture` enforces the current package-consumption contract:

- `@tearleads/client-sdk` stays private, ESM, side-effect-free, and source-only
  until a release build exists.
- Local `@tearleads/*` package dependencies stay on `workspace:*` ranges while
  the SDK is source-consumed inside the monorepo.
- The package export map matches the documented root, store, and workflow
  facades exactly, and the public API entry-point table stays in sync with it.
- `data/*` package exports and deep workflow/store implementation exports are
  rejected.
- Product window vocabulary such as `OrgManager` and `mini-app` stays in
  `packages/app`; SDK source should use platform workflow names.

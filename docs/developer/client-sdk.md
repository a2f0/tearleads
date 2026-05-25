# Client SDK

`@tearleads/client-sdk` is the React-free client runtime package. It owns local
SQLite execution, identity key state, blob storage, and workflow runtime
composition. React providers, browser workers, Electron wrappers, and UI stores
should adapt host-specific behavior into this package rather than duplicating
SDK setup.

## Quick Start

Create one SDK instance for the active client environment:

```ts
import { DEFAULT_DOCUMENT_KIND, Tearleads } from "@tearleads/client-sdk";
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
const documents = tearleads.documents.runtime(tearleads.session.containerId);
const documentStore = tearleads.documents.store();
const localNotes = await tearleads.documents.listLocalSummaries({
  documentKind: DEFAULT_DOCUMENT_KIND,
});
const containerDocumentReadModel =
  tearleads.containerContents.documentReadModel();
const containerDocumentLinksRuntime =
  tearleads.containerContents.documentLinksRuntime();
const containerContentsStore = tearleads.containerContents.store();
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
| `tearleads.documents` | document stores, local document summaries, local document deletion, and document workflow runtime composition |
| `tearleads.containerContents` | container contents stores, read models, document-link runtimes, discovery, diagnostics, and workflow runtime composition |
| `tearleads.organizations` | organization administration and directory operations |
| `tearleads.userKeys` | verified user key lookup for product read models and recipient UIs |

Prefer these instance services over constructing workflow runtimes directly
from host code. The SDK keeps workflow cache scope aligned with the active
database id and identity fingerprint, which lets document and
container/document stores share the same sync and subscription boundary.
Product app code should prefer `tearleads.documents.store(...)`,
`tearleads.documents.primeStore(...)`, and
`tearleads.documents.subscribeToLocalSummaries(listener, { containerId })` over
importing the document store facade package directly.

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

Prefer the grouped fields for new host and workflow integration code so a
consumer's dependency boundary is visible. The top-level fields remain
compatibility aliases for existing callers during the runtime input migration.

## Workflow Facade Taxonomy

SDK workflow facades expose client platform capabilities. Product UI, route
state, menu labels, component-local hooks, and React providers stay in
`packages/app`.

| Facade | Classification | Boundary |
| --- | --- | --- |
| `workflows/documents`, `workflows/blobs`, `workflows/containers`, `workflows/principals`, `workflows/registration`, `workflows/sync` | Platform runtime | Protocol-facing client operations, local persistence orchestration, sync coordination, key verification, and registration bootstrap helpers |
| `workflows/container-contents` | Platform read model and runtime | Container tree state, container metadata documents, document link/discovery read models, diagnostics, and sync-state helpers. The container-contents store facade adapts these into UI state without React. |
| `workflows/organizations` | Platform organization administration | Organization roster/directory, encrypted roster profile document binding, groups, grants, usage, user-detail read models, and principal-policy mutation helpers; the Org Manager mini-app adapts these into product screens in `packages/app` |

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

`documentProjectors` may be either a prebuilt `DocumentProjectorRegistry` or a
readonly array of `DocumentProjectorDefinition` values. Prefer passing
definitions when integrating an app-owned document type list; the SDK will
normalize and cache the registry internally.

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
| `getSQLitePersistenceRuntime(execSql)` | Building typed Drizzle queries against the active SDK SQLite executor |
| `defineSqlTableSchema(table)` | Rendering app-owned Drizzle SQLite table definitions for `ensureSqlTables` |
| `ExecSql`, `SqlTableSchema`, `ensureSqlTables`, `runSerializedSqlMutation` | Explicit executor, schema, and mutation helpers for host-owned persistence edges |

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
| `@tearleads/client-sdk` | `Tearleads`, top-level SDK service types, document contracts, store facades, and workflow facade symbols that remain public |
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
| `@tearleads/client-sdk` | SDK instance, public service types, document contracts, store facades, and workflow facade symbols that remain public |
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
document-link input, while the lower-level container read-model link input is
available as `ContainerDocumentReadModelLinkInput`.

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

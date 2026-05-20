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
import { createModuleDatabaseRuntime } from "@tearleads/sqlite-worker/runtime";

const databaseRuntime = createModuleDatabaseRuntime();
await databaseRuntime.client.init({
  dbName: "/app-identity.db",
  cipher: "chacha20",
  key: "development-key", // For development only. Do not use in production.
});

const tearleads = new Tearleads({
  apiBaseUrl: "http://localhost:3000",
  database: {
    client: databaseRuntime.client,
    id: databaseRuntime.id,
    status: "ready",
  },
  logger: {
    log: console.log,
    logError: console.error,
  },
});

await tearleads.identity.generate();
await tearleads.session.bootstrapLocalRootContainer();

const explorer = tearleads.workflows.explorer();
const documents = tearleads.workflows.documents({
  containerId: tearleads.session.containerId,
});
```

The instance intentionally groups client capabilities by responsibility:

| Namespace | Owns |
| --- | --- |
| `tearleads.api` | HTTP API calls and auth token headers |
| `tearleads.db` | SQLite client and `ExecSql` executor |
| `tearleads.identity` | signing and encapsulation key pairs |
| `tearleads.blobs` | local blob byte storage |
| `tearleads.session` | auth token and user/org/container context |
| `tearleads.network` | online/offline state passed into sync workflows |
| `tearleads.events` | remote event list passed into sync workflows |
| `tearleads.workflows` | React-free domain workflow runtimes |

Prefer `tearleads.workflows.*()` over constructing workflow runtimes directly
from host code. The SDK keeps workflow cache scope aligned with the active
database id and identity fingerprint, which lets document, contacts, and
explorer stores share the same sync and subscription boundary.

## Workflow Facade Taxonomy

SDK workflow facades expose client platform capabilities. Product UI, route
state, menu labels, component-local hooks, and React providers stay in
`packages/app`.

| Facade | Classification | Boundary |
| --- | --- | --- |
| `workflows/documents`, `workflows/blobs`, `workflows/containers`, `workflows/principals`, `workflows/registration`, `workflows/sync` | Platform runtime | Protocol-facing client operations, local persistence orchestration, sync coordination, key verification, and registration bootstrap helpers |
| `workflows/explorer` | Platform read model and runtime | Container tree state, container metadata projection, document link/discovery read models, and container/document sync helpers used by Explorer UI without owning Explorer presentation state |
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

Use `apiBaseUrl` for the default `ApiClient`, or pass an existing `apiClient`.
Use `database.client` for a SQLite worker client that implements
`ExecSqlClientLike`; the SDK creates the canonical `ExecSql` adapter from it.
Use `database.execSql` only when the host already owns executor construction.

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
`tearleads.session.setUserId(...)`, `setOrganizationId(...)`, and
`setContainerId(...)` as the API returns canonical IDs. Login stores the auth
token on both `tearleads.session` and `tearleads.api`:

```ts
const authenticated = await tearleads.session.login();
```

## Public API Entry Points

Supported package entry points are:

| Entry point | Use for |
| --- | --- |
| `@tearleads/client-sdk` | `Tearleads`, aggregate compatibility exports, and SQLite executor contracts |
| `@tearleads/client-sdk/documents` | neutral document/blob contracts and document projector helpers |
| `@tearleads/client-sdk/stores/documents` | React-free document store facade |
| `@tearleads/client-sdk/workflows/blobs` | blob upload, hydration, and local blob stores |
| `@tearleads/client-sdk/workflows/contacts` | contacts runtime and read/write helpers |
| `@tearleads/client-sdk/workflows/containers` | container mutation planning and remote container operations |
| `@tearleads/client-sdk/workflows/documents` | document creation, sync, persistence, and projection-key helpers |
| `@tearleads/client-sdk/workflows/explorer` | explorer container/document read models and sync helpers |
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

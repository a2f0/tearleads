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

const tearleads = new Tearleads();
```

All constructor options are optional. The minimal instance uses same-origin API
routes, memory blob storage, default logging, and an idle database. Publish an
initialized SQLite runtime when persistence, sync, or identity generation is
needed:

```ts
tearleads.database.configure({
  client: sqliteRuntime.client,
  id: sqliteRuntime.id,
});
```

Single-identity clients can ask the constructor to start local identity
provisioning once SQLite becomes ready:

```ts
const tearleads = new Tearleads({
  identityProvisioning: "auto",
});
```

Automatic provisioning calls `tearleads.identity.generate()` when no signing key
pair exists and the database is ready. Hosts that need the root container id
immediately can keep the explicit call after configuring SQLite:

```ts
const { rootContainerId } = await tearleads.identity.generate();
```

## Advanced Configuration

Hosts that own API routing, encrypted blob storage, keyring-derived
`localKeys`, and logging can pass those adapters explicitly:

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

Client capabilities:

| Namespace | Owns |
| --- | --- |
| `tearleads.database` | SQLite client and `ExecSql` executor |
| `tearleads.identity` | signing and encapsulation key pairs, seed phrase state |
| `tearleads.blobs` | local blob byte storage |
| `tearleads.session` | registration, auth token, personal-org identity, and active context |
| `tearleads.network` | online/offline state passed into sync workflows |
| `tearleads.events` | remote event list passed into sync workflows |
| `tearleads.runtime` | workflow runtime input snapshots for host stores and providers |
| `tearleads.documents` | document editing, lists, deletion, subscriptions, and runtime composition |
| `tearleads.containerContents` | container tree, document queries/links, discovery, diagnostics, and runtime composition |
| `tearleads.deviceFirst` | shared locally durable container mutation store, instant container/document projection, and background reconciler |
| `tearleads.organizations` | strict local-first organization and durable data-usage projections, plus exact-head history from verified policy storage |
| `tearleads.userIdentities` | pinned user identity bundles for cryptographic workflows |
| `tearleads.securityIncidents` | append-only local records of terminal trust-boundary verification failures |

Prefer instance services to hand-built runtimes. The SDK aligns workflow cache
scope with the active database and identity so document and container/document
stores share a sync and subscription boundary. Product app code should use:
`tearleads.documents.open(...)`, `tearleads.documents.list(...)`,
`tearleads.documents.subscribe(listener, { containerId })`,
`tearleads.deviceFirst.open().containerStore`, and
`tearleads.containerContents.documentQueries()`. For orphan recovery, queries
accept a null container plus the active organization; use the indexed
`hasOrphanedDocuments(...)` visibility probe. Import internals only when
developing the SDK or a custom host.

Document stores initialize automatically before mutating operations such as
`setText(...)`, `setStructuredFields(...)`, `attachFiles(...)`,
`replaceAttachment(...)` — the one attachment-write API — and
`relink(...)`. Call `ensureInitialized()` only when host code needs an explicit
readiness probe without performing a mutation, for example before reading a
ready snapshot or deciding whether to show an unavailable-storage state.

Host adapters that still need the raw workflow runtime contract should use
`tearleads.runtime.input(containerId)` instead of reconstructing the dependency
bundle themselves. This host-facing runtime input intentionally does not expose
the raw API client; SDK namespaces and workflow facades own HTTP transport
access.

Root exports include built-in organization slot helpers.

`tearleads.network` defaults to automatic mode: browser events and API request
results set `online`. Hosts can force diagnostics with `setMode("offline")` or
`setMode("online")`, then resume detection with `setMode("automatic")`.

Runtime input snapshots are grouped by capability:

| Group | Fields |
| --- | --- |
| `auth` | `userId`, `defaultOrganizationId`, `organizationId`, `isAuthenticated` |
| `crypto` | `signingKeyPair`, `signingFingerprint`, `encapsulationKeyPair` |
| `infra` | `dbStatus`, `execSql`, `blobStore`, `documentProjectors` |
| `state` | `containerId`, `domainScope`, `events`, `online` |
| `util` | `log`, `logError`, `cacheReferencedPrincipalPolicies` |

`auth.defaultOrganizationId` identifies the personal org across active switches.
Host and workflow integration code should use these grouped fields so a
consumer's dependency boundary is visible. Runtime snapshots expose grouped
capabilities only.

`tearleads.containerContents.workflowRuntime()` remains available to advanced
host stores and includes root adoption. Custom hosts assembling a store directly
must use `createContainerContentsStoreWorkflowRuntime(input, adopter)`; the
adopter atomically validates and updates the session root. The general workflow
factory has no root-adoption capability. Most product code should use the
higher-level helpers.

`tearleads.containerContents.documentQueries().listPendingWrites()` returns an
identity-wide, locally derived view of durable writes that have not converged.
Rows are grouped by logical container, document, or unknown document namespace
and include safe navigation metadata plus aggregate operation counts, attachment
bytes, move targets, status, and persisted intent errors. A document whose
read-only revalidation was refused surfaces as a diagnostic `revalidation`
item even with zero queued writes, so a document that can never refresh is
visible; such items carry no local data and never offer the destructive
discard. Serialized Loro
updates, local blob storage keys, and upload cryptographic material stay private.
This answers what remains pending; sync snapshots show scheduler work
and `blobStorageKey` navigation into Blob Browser.

Two per-row recovery actions pair with that view.
`documentQueries().retryPendingWriteItem(...)` resets the item's parked retry
state (for documents, the durable re-key budget; the recorded terminal failure
clears only alongside queued work — a failure-only revalidation row survives as
the priming ticket and clears on the next clean pass) before the caller re-arms
the sync lanes and, for documents, requests a priming pass.
`discardRegisteredDocumentLocalState(domainScope, localId, documentId)` is the
give-up path for a remote-backed document whose queue can never converge: one
transaction converts the local record to the freshly-discovered-share shell
(queued updates, staged uploads, durable history, kind projections, and the
failure row dropped; identity, title, placement, and links kept) and the store
re-pulls the server copy. Local-only, unlinked, and move-pending documents are
refused. `requestContainerContentsDocumentPriming(domainScope)` re-arms the
structural pass's document-priming scan for callers outside a registered store.

Document diagnostics keep the default read bounded: `loadDocumentInfo(...)`
uses at most 2,000 compact effective attribution intervals for contributor and
local blame derivation. An explicitly `truncated` result disables partial blame.
Per-upload provenance is lazy through `loadDocumentAttributionRanges(...)`;
follow `nextCursor` only while Edit Ranges is visible. Cursors bind the document
incarnation and attribution revision, so stale pages fail instead of mixing
histories.

### Device-first reads, writes, and background reconciliation

`tearleads.deviceFirst.open()` returns one shared scope containing the locally
durable `containerStore`, the synchronously readable `view`, and the background
`reconciler`. Ordinary tree writes persist and update subscribers locally, then
converge through durable sync lanes without blocking on the network. The view's
`ready` reflects **local** hydration only (never auth/network), while the
reconciler owns remote discovery and prioritizes the active container.
Security-sensitive sharing, remote deletion, and purge operations retain their
explicit online/remote-authority requirements. See
[device-first.md](./device-first.md).

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
  identityProvisioning,
  identityTrustDomain,
  logger,
  onSecurityIncident,
  online,
});
```

Every option is optional. Defaults are local and host-neutral: same-origin API
paths, memory blob storage, ignored `log` messages, `console.error` errors, and
an idle database.

`documentProjectors` may be either a prebuilt `DocumentProjectorRegistry` or a
readonly array of `DocumentProjectorDefinition` values. Prefer passing
definitions when integrating an app-owned document type list; the SDK will
normalize and cache the registry internally.

HTTP uses `apiBaseUrl`; the API client is internal. See
[identity trust](./trusted-user-identity.md) for TOFU configuration.
Use `database.client` for a SQLite worker client that implements
`ExecSqlClientLike`; the SDK creates the canonical `ExecSql` adapter from it.
Use `database.execSql` only when the host already owns executor construction.

`onSecurityIncident` is called after a typed keying-verification failure is
durably appended. The same rows are available through
`await tearleads.securityIncidents.list()` and new rows can be observed with
`tearleads.securityIncidents.subscribe(listener)`. An incident contains the
code, operation, timestamp, protocol hashes, plus object identity and trust
domain when known. It stores no exception messages or content.
Ordinary transport and database-availability failures do not create incidents.

`new Tearleads(...)` does not initialize SQLite or call `client.init(...)`. The
constructor only captures the current database `client`, `execSql`, and `id`,
deriving status unless the host supplies an explicit lifecycle override. If the
host has already initialized the worker, pass the runtime into the constructor;
the SDK infers `status: "ready"` from the configured client or executor:

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
import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
```

`SQLiteRuntime` is the host lifecycle object with `{ id, client,
destroy() }`. The lower-level `@tearleads/sqlite-worker` package still owns the
worker thread implementation, but host application code should prefer the SDK
facade so database setup, executor contracts, and workflow runtime integration
stay behind one developer-facing package.

The SQLite facade exposes lower-level database runtime capabilities through SDK
SQLite vocabulary:

| SDK export | Use for |
| --- | --- |
| `createSQLiteRuntime(options?)` | Creating the default module-worker runtime, optionally with `workerUrl` or a custom `workerConstructor` |
| `createSQLiteRuntimeFromWorker(worker)` | Wrapping a host-created terminable worker-like object |
| `SQLiteRuntime` | The `{ id, client, destroy() }` lifecycle contract returned by both runtime factories |
| `SQLiteWorkerClient` | The worker client contract accepted by `database.client` through `ExecSqlClientLike` |
| `CreateSQLiteRuntimeOptions`, `SQLiteModuleWorkerConstructor`, `SQLiteModuleWorkerLike` | Host adapter types for custom module-worker construction |
| `getSQLitePersistenceRuntime(execSql)` | Building typed Drizzle queries against the active SDK SQLite executor |
| `defineSqlTableSchema(table)` | Rendering app-owned Drizzle SQLite table definitions for `ensureSqlTables` |
| `ExecSql`, `SqlTableSchema`, `ensureSqlTables`, `runSerializedSqlMutation` | Explicit executor, schema, and mutation helpers for host-owned persistence edges |
| `resetConnectionSchemaMemo(execSql)` | Forgetting the connection's completed schema-ensure memo after a host operation rebuilds tables out from under the runtime (local backup restore) |

Host runtime code should use this facade instead of importing
`createDatabaseRuntime`, `createModuleDatabaseRuntime`, `DatabaseRuntime`, or
`DatabaseWorkerClient` from `@tearleads/sqlite-worker` directly. Worker-thread
entry files and low-level SQLite tests may still import the underlying worker
package when they are implementing or exercising the worker itself.

Identity setup is asynchronous because the signing fingerprint is derived from
the public key and local root setup requires SQLite. `generate()` requires a
ready SQLite database, creates or reuses the local root container, and stores it
on `tearleads.session.containerId` before resolving:

```ts
const result = await tearleads.identity.generate();

result.rootContainerId;
result.rootContainerCreated;
result.seedPhrase;
result.userId;
```

If SQLite is not ready or local root bootstrap fails when `generate()` runs, the
promise rejects and the previous identity snapshot is left in place. Configure
the database and then call `generate()` again. The `Tearleads` constructor stays
synchronous, so constructor-provided identity key pairs are available through
`tearleads.identity.snapshot`, but callers should use
`refreshSigningFingerprint()` or `setKeyPairs(...)` when they need the derived
fingerprint asynchronously.

Generated identities are seed-backed: `generate()` creates a 24-word BIP39
English phrase on the result/snapshot. `importSeedPhrase(...)` regenerates the
key pairs; session/container recovery remains host-owned.

Set `identityProvisioning: "auto"` to provision a single-identity SDK instance
once SQLite is available. It schedules `identity.generate()` when the database
is ready and no signing key pair exists, and does not initialize SQLite, replace
an existing signing key, block the constructor, or provision again after a
successful automatic provisioning.

When an identity fingerprint is available, the default blob store switches from
an ephemeral memory store to the identity-scoped store returned by
`createBlobStore(signingFingerprint)`. Hosts that need a custom blob backend
pass a fixed `blobStore`, or `blobStoreFactory` for identity-scoped stores, at
construction. The default and factory-backed stores still switch namespaces
automatically with identity (and via
`useEphemeralStore`/`useIdentityNamespace`); a fixed `blobStore` is used as
given, and arbitrary post-construction store replacement is gone.

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

## Local Keyring

The SDK exports a local keyring helper for host-controlled at-rest secret
management:

```ts
import {
  createBrowserLocalKeyring,
  createLocalKeyring,
  createWebViewLocalKeyring,
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

`createBrowserLocalKeyring()` stores both the JSON manifest and the wrapping-key
handle in IndexedDB; the wrapping key is a non-extractable AES-GCM `CryptoKey`.
The wrapped account-root secret and browser `CryptoKey` survive same-origin app
restarts; `keyring.deleteSession(scope)` removes both. Hosts that need custom
storage can compose `createIndexedDbWrappingKeyKeystore(...)` with an explicit
manifest store.

WKWebView-based shells that cannot structured-clone `CryptoKey` objects into
IndexedDB can use `createWebViewLocalKeyring()`. It uses the same manifest and
wrapping-key ids as `createBrowserLocalKeyring()`, but writes new wrapping keys
as raw AES-256 bytes to avoid the WebKit keychain clone path. It does not
interchange records with the browser `CryptoKey` mode, so hosts must choose the
appropriate storage mode before creating local identity data. Raw-byte storage
is weaker at rest, so browser hosts should keep the default
`createBrowserLocalKeyring()` wiring when `CryptoKey` cloning works.

`createPinCodeBrowserLocalKeyring({ pinCode })` enables opt-in PIN
locking.

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
The browser IndexedDB helper is durable but origin-bound: same-origin code can
ask the stored `CryptoKey` to unwrap the local secret even though it cannot
export the key bytes. Hosts needing
unlock can use `createPinCodeWrappingKeyKeystore`, passphrases, OS keychains,
or secure enclaves.
Call `session.dispose()` when a host is done with a local keyring session; it
zeroes the in-memory root and derived byte keys owned by that session.
Built-in keyrings implement optional `close()` for resource release. Caller-held
sessions remain valid until `session.dispose()`.
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
| `@tearleads/client-sdk` | `Tearleads`, SDK service types, local keyring helpers, document contracts, sync diagnostics, stores, purchase capabilities, and public workflow symbols |
| `@tearleads/client-sdk/sqlite` | SQLite worker runtime factory, executor contracts, and adapter helpers |
| `@tearleads/client-sdk/testing` | Nominal trusted-identity fixtures for lower-level repository integration tests; never production code |

Each package export maps `types` to an emitted `.d.ts` file and `default` to an
emitted ESM JavaScript file under `dist`. The export map is exact. Host code
reaches document contracts, store facades, and public workflow symbols through
the root entry point; the SQLite entry point owns its runtime adapter boundary,
and the testing entry point is forbidden from production source.

Do not import `@tearleads/client-sdk/data/*` from host code. The root entry
point aggregates documented public facades and does not make `data/*` internals,
deep workflow files, or store implementation files public. Promote a contract
through the root entry point when it is meant to become public.

When a lower-level workflow facade name conflicts with a root service type, the
root meaning stays stable and the lower-level name is exposed under a distinct
alias. For example, root `ContainerDocumentLinkInput` is the high-level client
document-link input, while the lower-level container query link input is
`ContainerDocumentQueriesLinkInput`.

Container KEK-history recovery is public workflow surface: `rekeyRemoteContainer`
performs an explicit rotation (and, with `keyringEntriesOverride`, the repair
that replaces a poisoned keyring snapshot), `rebuildKeyringEntriesFromLog`
reconstructs history from the `GET /containers/:id/kek-log` bridge log, and
`recoverKeyringEntryFromWraps` recovers a bridge-severed epoch from the caller's
retained recipient envelope.

Principal rotations and membership changes rematerialize every retained group
grant against the new current principal head in the same transaction. As a
result, `recoverKeyringEntryFromWraps` resolves group-addressed anchors through
current verified principal policies and does not need a historical-principal
reader. See
[keying-design.md](../keying-design.md#container-key-epoch-database-row) for the
artifact model these operate on.

### Purchase capabilities

Org sync billing exposes two provider-neutral capabilities:

| Capability | Who owns the payment UI | Injected by |
| --- | --- | --- |
| `PurchasesCapability` | App Store or Play; web uses it only to observe RevenueCat entitlements | `AppHostConfig.createPurchases` |
| `DirectCheckoutCapability` | The app around Stripe's mounted element | `AppHostConfig.createDirectCheckout` |

Both ship an unavailable stub (`createUnavailablePurchases` and
`createUnavailableDirectCheckout`). Web keeps entitlement reads but uses direct
checkout. Native purchases are personal-org only. `PurchaseIdentityPendingError`
means retry; `PurchaseProviderStalledError` means restart. Recover
`PurchaseAlreadyOwnedError` with `purchases.moveNativeSubscription`; its `claim`
calls `tearleads.organizations.claimNativeSubscription`. Never split
restore/claim/bind: the atomic move keeps one buyer and publishes attribution
only after acceptance.
See [revenuecat-billing.md](./revenuecat-billing.md).

## Package Contract

The package is `private: true` and consumed across the monorepo by build output.
The build emits ESM JavaScript, inline-source source maps, and declaration files
from `tsconfig.build.json`, replacing any previous `dist`:

```sh
bun run --filter='@tearleads/client-sdk' build
```

`bun run lint:architecture` enforces the package-consumption contract:

- `@tearleads/client-sdk` is private, ESM, side-effect-free, and backed by
  build-output package exports.
- Local `@tearleads/*` package dependencies use `workspace:*` ranges.
- The package export map matches the documented root and SQLite entry points
  exactly, points at `dist` JavaScript/declaration files, and stays in sync with
  the public API entry-point table.
- `data/*`, document, store, workflow, and deep implementation package exports
  are rejected.
- App code uses SDK root service surfaces instead of importing SDK document,
  workflow, or store package facades directly.
- Product window vocabulary such as `OrgManager` and `mini-app` stays in
  `packages/app`; SDK source uses platform workflow names.

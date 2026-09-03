# Subsystems

A **subsystem** is a stable proper noun for a slice of the system that a
developer reasons about as one unit — for example "Containers" or "Realtime
Sync". It is the name we use in conversation, PR descriptions, and code review
to say _where a feature lives_ and _who owns it_.

A subsystem is **descriptive, not a new boundary**. It is an ownership and
navigation index laid over paths that already exist. Import direction stays
enforced by the lanes, layers, and planes in `dependency-cruiser.config.ts`; the
file-size and barrel rules stay in `scripts/lintSourceShape.ts`. A subsystem may
deliberately span several layers — `Containers` covers its routes, its service
facade, and its transaction-orchestration workflows — which is exactly the
scatter the registry makes greppable. See AGENTS.md "## Subsystems" for how this
term relates to plane / layer / lane / facade.

## How it is kept honest

- `scripts/subsystems.ts` is the machine-readable manifest: each subsystem lists
  the path prefixes and exact files it owns.
- The `subsystem-registry-covers-every-source-file` architecture check requires
  every production source file in a registered package to map to **exactly one**
  subsystem, so a newly added file that finds no home fails `bun run
  lint:architecture` instead of silently becoming an orphan.
- The `subsystem-registry-matches-docs` check keeps the table below in lockstep
  with the manifest.

Rolled out package by package. Registered: `packages/api`,
`packages/client-sdk`, `packages/app`.

## Registry

<!-- subsystems:start -->

### API — `packages/api/src/`

| Subsystem | Owns | Public seam | Source paths |
| --- | --- | --- | --- |
| **Containers** | Container CRUD, grant/revoke/rekey/move, accessible-container listing with sync paging, and writer-projection access resolution. | `routes/containers` via `createContainerRouter`; `services/containers` facade | `routes/containers/`, `services/containers/`, `workflows/containers/` |
| **Documents** | Document update storage, version-vector spans, commit LSN, audit entries/checkpoints/hash history, sync baseline redirect, and edit attribution. | `routes/documents`; `services/documents` facade | `routes/documents/`, `services/documents/`, `workflows/documents/`, `documents/` |
| **Blobs & Attachments** | Multipart blob staging, binary retrieval streaming, attachment binding, and the injectable blob object store (memory or S3). | `routes/blobs`; `services/blobs` facade; `BlobObjectStore` adapter | `routes/blobs/`, `services/blobs/`, `workflows/blobs/`, `adapters/blobObjectStore.ts`, `adapters/defaultBlobObjectStore.ts`, `adapters/s3BlobObjectStore.ts`, `adapters/s3BlobObjectStreams.ts` |
| **Organizations** | Org directory, profile, roster, groups, container grants, and data-usage read models and mutations. | `routes/organizations`; `services/organizations` facade | `routes/organizations/`, `services/organizations/`, `workflows/organizations/` |
| **Billing** | Per-organization billing lifecycle (local/trial/active), the free-sync trial, and the sync-eligibility gate that fronts server sync. | `routes/billing` via `createBillingRouter`; `services/billing` facade | `billing/`, `routes/billing/`, `services/billing/`, `workflows/billing/` |
| **Principals** | Principal policy projection and current-policy reads plus atomic signed-policy writes for managed groups/organizations, including access-transition tombstone bookkeeping (loss inserts and regained-access pruning). | `routes/principals`; `services/principals` facade | `routes/principals/`, `services/principals/`, `workflows/principals/`, `workflows/regainedAccessTombstones.ts` |
| **Auth & Registration** | Challenge-response login, user registration, logout, session listing, and the websocket-ticket minting endpoint. | `routes/auth`; `services/auth` facade | `routes/auth/`, `services/auth/`, `workflows/auth/` |
| **Access Plane & Keying** | The encrypted access plane: signed access manifests, KEK state, content-key bundles, principal state, and the access-event/manifest projection codec. | `access/read/*.ts` and `access/write/*.ts` facades (composed only by workflows) | `access/`, `keyingProjectionManifestRecords.ts`, `keyingProjectionRecords.ts`, `workflows/keyingReadAccess.ts`, `workflows/signerPublicKey.ts` |
| **Realtime Sync** | Process-local fan-out of Redis pub/sub events to interested sockets: the WS lifecycle, interest index, Redis interest mirror, and upgrade tickets. | `createRealtimeGateway`, assembled and started by `index.ts` | `realtime/publishedRealtimeEvents.ts`, `realtime/realtimeGateway.ts`, `realtime/wsConnection.ts`, `realtime/wsOrganizationRouting.ts`, `realtime/wsRouting.ts`, `realtime/wsInterestStore.ts`, `realtime/wsTicket.ts`, `realtime/wsIdentity.ts` |
| **Session Lifecycle** | Bearer-token session storage, activity/IP tracking, request-IP binding, and session revocation (clear WS interest + publish `session_revoked`). | `middleware/session.ts` (`requireAuth`) and `realtime/sessionRevocation.ts` | `middleware/session.ts`, `realtime/sessionRevocation.ts`, `validators/session.ts`, `requestContext.ts` |
| **Service Runtime & Composition Root** | The HTTP composition root: Hono app assembly, shared request validation, the `ApiServiceRuntime` dependency object, the test override seam, and the server entry point. | `routeApp.ts` / `routeAppDeps.ts`; `ApiServiceRuntime` from `services/runtime.ts` | `routeApp.ts`, `routeAppDeps.ts`, `corsOrigins.ts`, `index.ts`, `appTestRuntime.ts`, `services/databaseWorkflowService.ts`, `services/runtime.ts`, `routes/health.ts`, `validators/headers.ts`, `validators/jsonRequest.ts`, `validators/pathParams.ts`, `validators/queryParams.ts` |
| **Infrastructure Adapters** | Effectful infrastructure boundaries other than blob storage: Redis key/value and pub/sub, plus the in-memory Redis used for tests and dev. | `adapters/redis.ts`, `adapters/redisPubSub.ts` (closed over by factories) | `adapters/redis.ts`, `adapters/redisPubSub.ts`, `adapters/inMemoryRedis.ts` |
| **Shared Utilities** | Package-neutral helpers reused across subsystems: arrays, canonical JSON, cursor encoding, SHA-256, bounded verification caching, SQL dialect, UUID generation, database error classification, and best-effort event publishing. | `utils/*` direct import | `utils/array.ts`, `utils/canonicalJson.ts`, `utils/cursor.ts`, `utils/databaseErrors.ts`, `utils/publishBestEffort.ts`, `utils/record.ts`, `utils/sha256.ts`, `utils/sqlDialect.ts`, `utils/storedVerificationCache.ts`, `utils/uuid.ts` |

### Client SDK — `packages/client-sdk/src/`

| Subsystem | Owns | Public seam | Source paths |
| --- | --- | --- | --- |
| **Document Store & Sync** | Client-side document open/list/delete, the per-scope document store, document workflow operations, persisted-document registry, and document summary/sync contracts. | `tearleads.documents` facade; `workflows/documents` | `workflows/documents/`, `data/documents/`, `stores/documents/`, `client/documents.ts`, `documents.ts` |
| **Container Contents** | Container tree projections, container metadata documents, document discovery/links/queries, blob info, and sync-state read models for product UI. | `tearleads.containerContents` facade; `workflows/container-contents` | `workflows/container-contents/`, `stores/container-contents/`, `client/containerContents.ts`, `client/containerContentsTypes.ts` |
| **Container Data** | Client-side container CRUD/share workflow operations and the local container persistence shape. | `workflows/containers` | `workflows/containers/`, `data/containers/` |
| **Client Blob Storage** | Active blob store selection (ephemeral vs identity-namespaced), OPFS/memory byte stores, encrypted envelopes, and blob workflow operations. | `tearleads.blobs` facade; `workflows/blobs`; `blobContracts` | `workflows/blobs/`, `data/blobs/`, `client/blobs.ts`, `data/blobContracts.ts` |
| **Organization Read Models** | Org directory/groups/grants/usage/user-detail read models, roster/profile mutations, and atomic principal-container rematerialization for the client. | `tearleads.organizations` facade; `workflows/organizations` | `workflows/organizations/`, `client/organizations/` |
| **Principal Policy (client)** | Client-side principal policy workflow operations, admin-signer resolution, and principal-policy crypto helpers. | `workflows/principals` | `workflows/principals/`, `data/principals/` |
| **Client Registration** | Identity registration and the initial organization/root-container bootstrap performed from the client. | `workflows/registration` | `workflows/registration/` |
| **Sync Engine** | The per-`DomainScope` sync coordinator (lanes, phases, coalescing), device-first local projection + background reconciliation, and the scope/peer-seed primitives that drive cache invalidation. | `tearleads.deviceFirst` facade; sync workflow facade snapshots | `workflows/sync/`, `data/sync/`, `sync/`, `stores/local-projection/`, `client/deviceFirst.ts`, `data/crdtPeerSeed.ts`, `data/domainScope.ts` |
| **Identity & Session** | Identity keypairs, auth context, and durable trust-on-first-use validation of complete user identity bundles. | `tearleads.identity/session/userIdentities` facades; `data/trustedUserIdentity` gateway | `client/identity.ts`, `client/identityKeyPackage.ts`, `client/session/`, `client/userIdentities.ts`, `data/trustedUserIdentity/` |
| **Local Keyring** | The on-device keyring (manifest storage, scopes, sessions) and its PIN-code unlock support. | `createLocalKeyring` / `createBrowserLocalKeyring` exports | `client/localKeyring/` |
| **Client Purchases** | Provider-agnostic purchase capabilities for org sync billing: the `PurchasesCapability` interface (provider-hosted flows) with the RevenueCat mapping core over an injectable backend, the `DirectCheckoutCapability` interface (an in-app payment element the app styles itself), and the unavailable stubs for both. | `createRevenueCatPurchases` / `createUnavailablePurchases` / `createUnavailableDirectCheckout` exports | `client/billing/` |
| **SQLite Runtime** | The local SQLite executor, Drizzle schema, transaction serialization, and the `@tearleads/client-sdk/sqlite` public worker-runtime entry point. | `@tearleads/client-sdk/sqlite` subpath; `data/sqlite` | `data/sqlite/`, `sqlite.ts` |
| **Local Persistence** | Domain-specific SQLite read/write modules that take an explicit `ExecSql` executor (containers, container-contents, documents, principal policy). | `data/persistence` (consumed by workflows with `ExecSql` threaded in) | `data/persistence/` |
| **Keying Verification** | Client-side cryptographic verification of server writer/access-manifest/link-set projections, canonical-record decode, access-level helpers, and stable resource-id derivation. | `data/keyingProjectionVerification` facade | `data/keyingProjectionVerification/`, `data/keyingProjectionVerification.ts`, `data/keyingCanonicalJson.ts`, `data/accessLevel.ts`, `data/principalPolicyStates.ts`, `data/stableUuid.ts` |
| **Security Incident Detection** | Durable, redacted detection records and host notifications for terminal client trust-boundary verification failures. | `tearleads.securityIncidents` facade; `onSecurityIncident` callback | `client/securityIncidents.ts`, `data/securityIncidents.ts` |
| **SDK Runtime & Composition Root** | The `Tearleads` facade that wires every SDK subsystem object, the runtime-snapshot projector, the SQLite database handle, the events/network state, logging, the platform I/O capability contracts (`NetworkStatusSource`, `FileSaver`), and the package root entry point. | `new Tearleads(options)`; the package root index | `client/Tearleads.ts`, `client/index.ts`, `client/rootContainerAdoption.ts`, `client/workflowRuntime.ts`, `client/database.ts`, `client/events.ts`, `client/network.ts`, `client/fileSaver.ts`, `client/syncBillingGate.ts`, `client/listenerSet.ts`, `client/logger.ts`, `data/errorMessage.ts`, `data/recordReaders.ts`, `index.ts`, `workflows/runtimeInput.ts` |

### App — `packages/app/src/`

| Subsystem | Owns | Public seam | Source paths |
| --- | --- | --- | --- |
| **Explorer** | The container/document explorer mini-app: tree, detail panels, sidebar windows, attribution, and its presentation store. | `mini-apps/explorer`; `stores/explorer` | `mini-apps/explorer/`, `stores/explorer/` |
| **Notes** | The notes mini-app: note editor, sidebar/context menus, and note presentation. | `mini-apps/notes` | `mini-apps/notes/` |
| **Contacts** | The contacts mini-app: contact list/detail UI and its presentation store. | `mini-apps/contacts`; `stores/contacts` | `mini-apps/contacts/`, `stores/contacts/` |
| **Org Manager** | The organization-management mini-app: directory, groups, grants, roster, and its presentation store. | `mini-apps/org-manager`; `stores/org-manager` | `mini-apps/org-manager/`, `stores/org-manager/` |
| **Identity Manager** | The identity-management mini-app: device keys, key-package backup, and identity UI. | `mini-apps/identity-manager` | `mini-apps/identity-manager/` |
| **System Monitor** | The system-monitor mini-app: runtime/sync/storage telemetry surfaces. | `mini-apps/system-monitor` | `mini-apps/system-monitor/` |
| **Backup & Restore** | The backup-and-restore mini-app: export/import of on-device state. | `mini-apps/backup-restore` | `mini-apps/backup-restore/` |
| **Mini-App Platform** | The window/mini-app host: app windows, the SDK-independent message bus, the app-shell-to-pane launcher bridge, the mini-app registry, the bootstrap/unlock gates, and shared cross-mini-app building blocks (e.g. the blob-pick host). | `mini-apps/registry`; `mini-apps/bus`; `mini-apps/shared` | `mini-apps/AppWindow.tsx`, `mini-apps/bus.tsx`, `mini-apps/LocalKeyringUnlockGate.tsx`, `mini-apps/miniAppLauncher.tsx`, `mini-apps/registry.ts`, `mini-apps/shared/`, `mini-apps/SystemBootstrapGate.tsx`, `mini-apps/types.ts` |
| **Document Types** | Shared document-type building blocks (note, contact, image, pdf, audio, file, cards) plus the type registry, importers, and projector definitions consumed by mini-apps. | `document-types/registry`; `document-types/projectors` | `document-types/` |
| **Document Projectors** | App-side client projections that derive structured document state (contact, credit-card, driver-license) for the projector registry. | `document-projectors/appDocumentProjectors` | `document-projectors/` |
| **App Shell & Components** | Reusable presentation: layout, pane, window, mini-app chrome, and shared components. | `components/*` | `components/` |
| **App Providers & Runtime** | The app composition root: the React provider stack (SDK, db, crypto, identity, events, host, local-keyring, logging, system-bootstrap), host config, and the app entry point. | `providers/AppRuntimeProvider`; `App.tsx` | `providers/`, `host/`, `App.tsx`, `client.tsx` |
| **Navigation** | App navigation: routed path navigation, history, mode/breakpoints, and mini-app route segments. | `navigation/AppNavigationProvider` | `navigation/` |
| **Theming** | Color themes: the theme registry, persisted selection, the `<html data-theme>` attribute stamp, and the footer theme toggle. The per-theme design-token blocks live in `@tearleads/ui`'s `styles.css`. | `theme/ThemeProvider`; `theme/themes` | `theme/` |
| **App Identity Provisioning** | App-level identity bootstrap: the identity autopilot, key-package backup, current-identity registration hooks, and the demo-only friendly peer bootstrap (auto-imported peer contact plus peer-labeled self/org names). | `identity/IdentityAutopilot`; `identity/useRegisterCurrentIdentity`; `demo/DemoPeerBootstrap` | `identity/`, `demo/` |
| **App Document & Device State** | App-side domain state machines for documents and device-first projection, plus the system-containers store and its org-aware Trash resolver. | `stores/documents`; `stores/device-first` | `stores/documents/`, `stores/device-first/`, `stores/systemContainers.ts`, `stores/systemContainerTrash.ts` |
| **App Utilities** | App-neutral presentation helpers: byte-length and date formatting, error-message normalization, and clipboard-safe billing traces. | `utils/*` direct import | `utils/billingPurchaseTrace.ts`, `utils/formatByteLength.ts`, `utils/formatMiniAppDate.ts`, `utils/unknownErrorMessage.ts` |

<!-- subsystems:end -->

## Adding or changing a subsystem

1. Edit `scripts/subsystems.ts` so the owning subsystem's `paths` claim the new
   file (or add a new subsystem entry).
2. Mirror the change in the table above.
3. Run `bun run lint:architecture`. The coverage check tells you about any file
   that maps to zero or more than one subsystem; the docs check tells you about
   any table/manifest drift.

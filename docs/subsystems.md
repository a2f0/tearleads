# Subsystems

A **subsystem** is a stable proper noun for a slice of the system that a
developer reasons about as one unit — for example "Containers" or "Realtime
Sync". It is the name we use in conversation, PR descriptions, and code review
to say _where a feature lives_ and _who owns it_.

A subsystem is an ownership and navigation index laid over paths that already
exist. Import direction stays enforced by the lanes, layers, and planes in
`dependency-cruiser.config.ts`. A subsystem may span several layers:
`Containers` covers its routes, service facade, and orchestration workflows. A
subsystem that declares a **surface** is also a boundary: other subsystems
import only its surface files.
See AGENTS.md "## Subsystems" for the related axes.

## How it is kept honest

- [`scripts/architecture/subsystems.ts`](../scripts/architecture/subsystems.ts)
  is the machine-readable manifest: each subsystem lists the path prefixes and
  exact files it owns. The client SDK's rows live in
  [`scripts/architecture/clientSdkSubsystems.ts`](../scripts/architecture/clientSdkSubsystems.ts).
- The `subsystem-registry-covers-every-source-file` architecture check requires
  every production source file in a registered package to map to **exactly one**
  subsystem, so a newly added file that finds no home fails `bun run
  lint:architecture` instead of silently becoming an orphan.
- The `subsystem-registry-matches-docs` check keeps the table below in lockstep
  with the manifest.
- `subsystem-imports-use-declared-surface` enforces surfaces; see
  [SDK seams](developer/client-sdk-seams.md#subsystem-surfaces).

Registered packages: [`packages/api`](../packages/api/),
[`packages/client-sdk`](../packages/client-sdk/), and
[`packages/app`](../packages/app/).

## Registry

<!-- subsystems:start -->

### API — [`packages/api/src/`](../packages/api/src/)

| Subsystem | Owns | Public seam | Source paths |
| --- | --- | --- | --- |
| **Containers** | Container CRUD, grant/revoke/rekey/move, accessible-container listing with sync paging, and writer-projection access resolution. | `routes/containers` via `createContainersRouter`; `services/containers` facade | `routes/containers/`, `services/containers/`, `workflows/containers/` |
| **Documents** | Document update storage, version-vector spans, commit LSN, rotation-baseline markers, sync baseline redirect, and edit attribution. | `routes/documents`; `services/documents` facade | `routes/documents/`, `services/documents/`, `workflows/documents/`, `documents/` |
| **Blobs & Attachments** | Multipart blob staging, binary retrieval streaming, attachment binding, and the injectable blob object store (memory or S3). | `routes/blobs`; `services/blobs` facade; `BlobObjectStore` adapter | `routes/blobs/`, `services/blobs/`, `workflows/blobs/`, `adapters/blobObjectStore.ts`, `adapters/defaultBlobObjectStore.ts`, `adapters/s3BlobObjectStore.ts`, `adapters/s3BlobDownloadUrl.ts`, `adapters/s3BlobUploadUrl.ts`, `adapters/s3BlobObjectStreams.ts` |
| **Organizations** | Org directory, profile, roster, groups, container grants, and data-usage read models and mutations. | `routes/organizations`; `services/organizations` facade | `routes/organizations/`, `services/organizations/`, `workflows/organizations/` |
| **Billing** | Per-organization billing lifecycle (local/trial/active), the free-sync trial, and the sync-eligibility gate that fronts server sync. | `routes/billing` via `createBillingRouter`; `services/billing` facade | `billing/`, `routes/billing/`, `services/billing/`, `workflows/billing/` |
| **Principals** | Principal policy projection and current-policy reads plus atomic signed-policy writes for managed groups/organizations, including access-transition tombstone bookkeeping (loss inserts and regained-access pruning). | `routes/principals`; `services/principals` facade | `routes/principals/`, `services/principals/`, `workflows/principals/`, `workflows/regainedAccessTombstones.ts` |
| **Auth & Registration** | Challenge-response login, user registration, logout, session listing, and the websocket-ticket minting endpoint. | `routes/auth`; `services/auth` facade | `routes/auth/`, `services/auth/`, `workflows/auth/` |
| **Root Administration** | Root-gated staff lookups of identities, activity, sessions, organizations, billing, synced data usage, RevenueCat webhook deliveries, and cross-organization billing maintenance health, plus suspension of non-root identities, each recorded in the root audit trail before it is answered, and the audit trail listing. | `routes/root` via `createRootRouter`; `services/root` facade; `middleware/root.ts` | `routes/root/`, `services/root/`, `workflows/root/`, `middleware/root.ts` |
| **Access Plane & Keying** | The encrypted access plane: signed access manifests, KEK state, content-key bundles, principal state, and the access-event/manifest projection codec. | `access/read/*.ts` and `access/write/*.ts` facades (composed only by workflows) | `access/`, `keyingProjectionManifestRecords.ts`, `keyingProjectionRecords.ts`, `workflows/keyingReadAccess.ts`, `workflows/signerPublicKey.ts` |
| **Realtime Sync** | Process-local fan-out of published realtime events to interested sockets: the WS lifecycle, per-socket interest index, and upgrade tickets. | `createRealtimeGateway`, assembled and started by `index.ts` and the realtime hub Durable Object | `realtime/publishedRealtimeEvents.ts`, `realtime/realtimeGateway.ts`, `realtime/gatewayHibernation.ts`, `realtime/organizationInterestAuthorization.ts`, `realtime/containerInterestAccess.ts`, `realtime/containerInterestAuthorization.ts`, `realtime/containerInterestDependencies.ts`, `realtime/containerInterestQueries.ts`, `realtime/containerInterestRevalidation.ts`, `realtime/containerInterestTypes.ts`, `realtime/hintScoping.ts`, `realtime/wsConnection.ts`, `realtime/wsOrganizationRouting.ts`, `realtime/wsRouting.ts`, `realtime/wsTicket.ts`, `realtime/wsIdentity.ts`, `realtime/wsSessionLiveness.ts` |
| **Session Lifecycle** | Bearer-token session storage, activity/IP tracking with a suspended-account re-check, history request lifetime, request-IP binding, and session revocation (publish `session_revoked`). | `middleware/session.ts` (`requireAuth`) and `realtime/sessionRevocation.ts` | `middleware/requestIp.ts`, `middleware/requestLifetime.ts`, `utils/principalHistoryWork.ts`, `middleware/session.ts`, `middleware/sessionActivity.ts`, `middleware/userActivity.ts`, `middleware/userSuspension.ts`, `realtime/sessionRevocation.ts`, `validators/session.ts` |
| **Service Runtime & Composition Root** | The HTTP composition root: Hono app assembly, shared request validation, the `ApiServiceRuntime` dependency object, the test override seam, and the Bun development server entry point. | `routeApp.ts` / `routeAppDeps.ts`; `ApiServiceRuntime` from `services/runtime.ts` | `routeApp.ts`, `routeAppDeps.ts`, `apiPublicOrigin.ts`, `corsOrigins.ts`, `diagnostics/`, `index.ts`, `appTestRuntime.ts`, `services/databaseWorkflowService.ts`, `services/runtime.ts`, `routes/errorResponse.ts`, `routes/health.ts`, `validators/headers.ts`, `validators/jsonRequest.ts`, `validators/pathParams.ts`, `validators/queryParams.ts`, `validators/requestBodyTooLarge.ts`, `validators/schema.ts` |
| **Infrastructure Adapters** | Effectful infrastructure boundaries other than blob storage: the key/value and pub/sub surface backed by the Workers Durable Objects, or by in-process state for the local server and tests. | `adapters/keyValueStore.ts`, `adapters/pubSub.ts` (closed over by factories) | `adapters/keyValueStore.ts`, `adapters/inMemoryKeyValueStore.ts`, `adapters/pubSub.ts` |
| **Workers Runtime** | The Cloudflare Workers composition root: the fetch and scheduled entry, environment binding into process.env, the SQLite Durable Object key/value store, the realtime hub Durable Object that hosts the gateway, scheduled maintenance, and the Loro WebAssembly alias. | `worker/index.ts` (Wrangler main); adapters reach it through `worker/environment.ts` | `worker/` |
| **Shared Utilities** | Package-neutral helpers reused across subsystems: arrays, canonical JSON, cursor encoding, SHA-256, server secrets, manifest dependency traversal, bounded verification caching, SQL dialect, database error classification, and best-effort event publishing. | `utils/*` direct import | `utils/array.ts`, `utils/byteBudgetCache.ts`, `utils/canonicalJson.ts`, `utils/cursor.ts`, `utils/databaseErrors.ts`, `utils/publishBestEffort.ts`, `utils/record.ts`, `utils/serverSecrets.ts`, `utils/sha256.ts`, `utils/sqlDialect.ts`, `utils/storedAccessEventVerification.ts`, `utils/storedManifestGraph.ts` |

### Client SDK — [`packages/client-sdk/src/`](../packages/client-sdk/src/)

| Subsystem | Owns | Public seam | Source paths |
| --- | --- | --- | --- |
| **Document Store & Sync** | Client-side document open/list/delete, the per-scope document store, document workflow operations, persisted-document registry, document summary/sync contracts, and their SQLite persistence. | `tearleads.documents` facade; `workflows/documents` | `workflows/documents/`, `data/documents/`, `data/persistence/documents/`, `stores/documents/`, `client/documents/` |
| **Container Contents** | Container tree projections, container metadata documents, document discovery/links/queries, blob info, sync-state read models for product UI, and their SQLite persistence. | `tearleads.containerContents` facade; `workflows/container-contents` | `workflows/container-contents/`, `data/persistence/container-contents/`, `stores/container-contents/`, `client/containerContents/` |
| **Container Data** | Client-side container CRUD/share workflow operations and principal-container rematerialization. | `workflows/containers` | `workflows/containers/`, `data/containers/` |
| **Client Blob Storage** | Active blob store selection (ephemeral vs identity-namespaced), OPFS/memory byte stores, encrypted envelopes, attachment content crypto and events, and blob workflow operations. | `tearleads.blobs` facade; `workflows/blobs`; `blobContracts` | `workflows/blobs/`, `data/blobs/`, `client/blobs/` |
| **Organization Read Models** | Org directory/groups/grants/usage/user-detail read models and their SQLite persistence, roster/profile mutations, and group container shares for the client. | `tearleads.organizations` facade; `workflows/organizations` | `workflows/organizations/`, `data/persistence/organizations/`, `client/organizations/` |
| **Root Console Client** | Root-only identity, organization, roster, billing, data usage, ops-health, RevenueCat webhook, and audit trail lookups and identity suspension, gated by the session's server-reported root flag. | `tearleads.root` facade; `workflows/root` | `workflows/root/`, `client/root/` |
| **Principal Policy (client)** | Client-side principal policy workflow operations, admin-signer resolution, principal-policy crypto helpers, and their SQLite persistence. | `workflows/principals` | `workflows/principals/`, `data/principals/`, `data/persistence/principalCurrentAcknowledgementPersistence.ts`, `data/persistence/principalHistory/`, `data/persistence/principalKeys/`, `data/persistence/principalMutationJournalPersistence.ts`, `data/persistence/principalPolicy/` |
| **Client Registration** | Identity registration and the initial organization/root-container bootstrap performed from the client. | `workflows/registration` | `workflows/registration/` |
| **Sync Engine** | The per-`DomainScope` sync coordinator (lanes, phases, coalescing), device-first local projection + background reconciliation, and the scope/peer-seed primitives that drive cache invalidation. | `tearleads.deviceFirst` facade; sync workflow facade snapshots | `workflows/sync/`, `data/sync/`, `sync/`, `stores/local-projection/`, `client/deviceFirst/`, `data/shared/domainScope.ts` |
| **Identity & Session** | Identity keypairs, auth context, and durable provenance-tagged pins of complete user identity bundles. | `tearleads.identity/session/userIdentities` facades; `data/trustedUserIdentity` gateway | `client/identity/`, `client/session/`, `data/trustedUserIdentity/`, `data/persistence/trustedUserIdentityPinPersistence.ts`, `data/persistence/trustedUserIdentityPinTransaction.ts` |
| **Local Keyring** | The on-device keyring (manifest storage, scopes, sessions) and its PIN-code unlock support. | `createLocalKeyring` / `createBrowserLocalKeyring` exports | `client/localKeyring/` |
| **Client Purchases** | Provider-agnostic purchase capabilities for org sync billing: the `PurchasesCapability` interface (provider-hosted flows) with the RevenueCat mapping core over an injectable backend, the `DirectCheckoutCapability` interface (an in-app payment element the app styles itself), and the unavailable stubs for both. | `createRevenueCatPurchases` / `createUnavailablePurchases` / `createUnavailableDirectCheckout` exports | `client/billing/` |
| **SQLite Runtime** | The local SQLite executor, Drizzle schema, transaction serialization, and the `@tearleads/client-sdk/sqlite` public worker-runtime entry point. | `@tearleads/client-sdk/sqlite` subpath; `data/sqlite` | `data/sqlite/`, `sqlite/` |
| **Keying Verification** | Client-side cryptographic verification of server writer/access-manifest/link-set projections, canonical-record decode, access-level helpers, stable resource-id derivation, and the checkpoints and bindings it persists. | `data/keyingProjectionVerification` facade | `data/keyingProjectionVerification/`, `data/keying/`, `data/persistence/keyingCheckpoints/`, `data/persistence/organizationFounderPersistence.ts`, `data/persistence/verifiedManifestBundlePersistence.ts` |
| **Security Incident Detection** | Durable, redacted detection records and host notifications for terminal client trust-boundary verification failures. | `tearleads.securityIncidents` facade; `onSecurityIncident` callback | `client/securityIncidents/`, `data/shared/securityIncidents.ts`, `data/persistence/securityIncidentPersistence.ts` |
| **SDK Shared Utilities** | Helpers every layer uses with no subsystem of their own: error messages, record readers, User Timing measures, timestamp selection, and the workflow runtime input contract. | direct import | `data/shared/errorMessage.ts`, `data/shared/recordReaders.ts`, `data/shared/userTiming.ts`, `data/persistence/latestTimestamp.ts`, `workflows/shared/` |
| **SDK Runtime & Composition Root** | The `Tearleads` facade that wires every SDK subsystem object, the runtime-snapshot projector, the SQLite database handle, the events/network/API-version state, logging, the platform I/O capability contracts (`NetworkStatusSource`, `FileSaver`), and the package root entry point. | `new Tearleads(options)`; the package root index | `Tearleads.ts`, `TearleadsOptions.ts`, `client/index.ts`, `client/runtime/`, `client/host/`, `index.ts` |

### App — [`packages/app/src/`](../packages/app/src/)

| Subsystem | Owns | Public seam | Source paths |
| --- | --- | --- | --- |
| **Explorer** | The container/document explorer mini-app: tree, detail panels, sidebar windows, attribution, and its presentation store. | `mini-apps/explorer`; `stores/explorer` | `mini-apps/explorer/`, `stores/explorer/` |
| **Notes** | The notes mini-app: note editor, sidebar/context menus, and note presentation. | `mini-apps/notes` | `mini-apps/notes/` |
| **Contacts** | The contacts mini-app: contact list/detail UI and its presentation store. | `mini-apps/contacts`; `stores/contacts` | `mini-apps/contacts/`, `stores/contacts/` |
| **Org Manager** | The organization-management mini-app: directory, groups, grants, roster, and its presentation store. | `mini-apps/org-manager`; `stores/org-manager` | `mini-apps/org-manager/`, `stores/org-manager/` |
| **Root Console** | The root mini-app: identity and organization directories, live sessions, account suspension, rosters, tabbed billing/history and data usage, RevenueCat webhook deliveries, organization usage, operations-health and RevenueCat webhook reports, and the root audit trail. Offered only to sessions the server reports as root. | `mini-apps/root` | `mini-apps/root/` |
| **Identity Manager** | The identity-management mini-app: device keys, key-package backup, and identity UI. | `mini-apps/identity-manager` | `mini-apps/identity-manager/` |
| **System Monitor** | The system-monitor mini-app: runtime/sync/storage telemetry surfaces. | `mini-apps/system-monitor` | `mini-apps/system-monitor/` |
| **Organizations Dashboard** | The organizations mini-app: every organization the user belongs to and the folders they can reach in each, independent of the active workspace. | `mini-apps/organizations` | `mini-apps/organizations/` |
| **Backup & Restore** | The backup-and-restore mini-app: export/import of on-device state. | `mini-apps/backup-restore` | `mini-apps/backup-restore/` |
| **Mini-App Platform** | The window/mini-app host: the mini-app registry and its windowing launcher definition, the SDK-independent message bus, the app-shell-to-pane launcher bridge, the bootstrap/unlock gates, and shared cross-mini-app building blocks (e.g. the blob-pick host). | `mini-apps/registry`; `mini-apps/bus`; `mini-apps/shared` | `mini-apps/AppWindow.tsx`, `mini-apps/bus.tsx`, `mini-apps/catalog.ts`, `mini-apps/LocalKeyringUnlockGate.tsx`, `mini-apps/miniAppLauncher.tsx`, `mini-apps/miniAppVisibility.ts`, `mini-apps/registry.ts`, `mini-apps/shared/`, `mini-apps/SystemBootstrapGate.tsx`, `mini-apps/types.ts`, `mini-apps/useVisibleMiniAppItems.ts` |
| **Document Types** | Shared document-type building blocks (note, contact, image, pdf, audio, file, cards) plus the type registry, importers, and projector definitions consumed by mini-apps. | `document-types/registry`; `document-types/projectors` | `document-types/` |
| **Document Projectors** | App-side client projections that derive structured document state (contact, credit-card, driver-license) for the projector registry. | `document-projectors/appDocumentProjectors` | `document-projectors/` |
| **App Shell** | The app's shells: layout and workspaces, the windowed pane that hosts mini-app windows and its footer taskbar, and the routed shell's chrome. Composes the runtime, navigation, and the mini-apps it renders. | `shell/layout/Layout`; `shell/pane/shell/Pane` | `shell/` |
| **Shared Components** | Reusable presentation below the shells: the mini-app UI kit (controls, tables, overlays, the error boundary) and shared components. Loads no mini-app. | `components/*` | `components/` |
| **App Providers & Runtime** | The app composition root: the React provider stack (SDK, db, crypto, identity, events, host, local-keyring, logging, system-bootstrap), host config, and the app entry point. | `providers/AppRuntimeProvider`; `App.tsx` | `providers/`, `host/`, `App.tsx`, `client.tsx` |
| **Navigation** | App navigation: windowing's launcher navigation for mini-app ids, the mode switch, and touch row sizing. | `navigation/AppNavigationProvider` | `navigation/` |
| **Theming** | Themes and wallpapers: lists for `@tearleads/windowing`'s `ThemeProvider` (stamps `<html data-theme>`) and `WallpaperProvider`, the footer toggle, Display Properties. Tokens: `@tearleads/ui`'s `styles.css`. | `theme/ThemeProvider`; `theme/themes`; `theme/WallpaperProvider`; `mini-apps/display-properties` | `theme/`; `mini-apps/display-properties/` |
| **App Identity Provisioning** | App-level identity bootstrap: the identity autopilot, key-package backup, current-identity registration hooks, and the demo-only friendly peer bootstrap (auto-imported peer contact plus peer-labeled self/org names). | `identity/IdentityAutopilot`; `identity/useRegisterCurrentIdentity`; `demo/DemoPeerBootstrap` | `identity/`, `demo/` |
| **App Document & Device State** | App-side domain state machines for documents and device-first projection, plus the system-containers store and its org-aware Trash resolver. | `stores/documents`; `stores/device-first` | `stores/documents/`, `stores/device-first/`, `stores/systemContainers.ts`, `stores/systemContainerTrash.ts` |
| **App Utilities** | App-neutral helpers: byte-size, date, and duration formatting, error-message normalization, clipboard-safe billing traces, file downloads, keyboard activation, stored preferences, and async derived state. | `utils/*` direct import | `utils/` |

<!-- subsystems:end -->

## Adding or changing a subsystem

1. Edit
   [`scripts/architecture/subsystems.ts`](../scripts/architecture/subsystems.ts)
   (or `clientSdkSubsystems.ts` for the client SDK) so the owning subsystem's
   `paths` claim the new file, or add a new subsystem entry.
2. Mirror the change in the table above.
3. Run `bun run lint:architecture`. The coverage check tells you about any file
   that maps to zero or more than one subsystem; the docs check tells you about
   any table/manifest drift.

import {
  blobStorageClientSurface,
  blobStorageSurface,
  containerContentsClientSurface,
  containerContentsSurface,
  containerDataSurface,
  deviceFirstClientSurface,
  documentStoreClientSurface,
  documentStoreSurface,
  identitySessionClientSurface,
  identitySurface,
  keyingVerificationSurface,
  localKeyringSurface,
  organizationClientSurface,
  organizationReadModelSurface,
  principalPolicySurface,
  purchasesSurface,
  registrationSurface,
  rootConsoleSurface,
  runtimeRootSurface,
  securityIncidentClientSurface,
  securityIncidentSurface,
  syncEngineSurface,
} from "./clientSdkSurfaces";
import {
  containerContentsReadableTables,
  containerContentsTables,
  documentStoreReadableTables,
  documentStoreTables,
  identityTables,
  keyingVerificationTables,
  organizationReadModelTables,
  principalPolicyTables,
  securityIncidentTables,
  syncEngineTables,
} from "./clientSdkTables";
import { packageSourcePath } from "./dependencySourceRoots";
import type { Subsystem } from "./subsystemTypes";

const sdk = packageSourcePath.clientSdk;

/** The `packages/client-sdk` rows of the subsystem manifest in `subsystems.ts`. */
export const clientSdkSubsystems: readonly Subsystem[] = [
  {
    name: "Document Store & Sync",
    package: "client-sdk",
    responsibility:
      "Client-side document open/list/delete, the per-scope document store, document workflow operations, persisted-document registry, document summary/sync contracts, and their SQLite persistence.",
    seam: "workflows/documents",
    paths: [
      `${sdk}/workflows/documents/`,
      `${sdk}/data/documents/`,
      `${sdk}/data/persistence/documents/`,
      `${sdk}/stores/documents/`,
    ],
    surface: documentStoreSurface,
    tables: documentStoreTables,
    readableTables: documentStoreReadableTables,
  },
  {
    name: "Document Store Client",
    package: "client-sdk",
    responsibility:
      "The tearleads.documents facade: document open/list/delete over the per-scope document store for the host.",
    seam: "tearleads.documents facade",
    paths: [`${sdk}/client/documents/`],
    surface: documentStoreClientSurface,
  },
  {
    name: "Container Contents Client",
    package: "client-sdk",
    responsibility:
      "The tearleads.containerContents facade: container tree, document discovery, and pending-write read models for product UI.",
    seam: "tearleads.containerContents facade",
    paths: [`${sdk}/client/containerContents/`],
    surface: containerContentsClientSurface,
  },
  {
    name: "Organization Client",
    package: "client-sdk",
    responsibility:
      "The tearleads.organizations facade: org read models, memberships, and share-recipient admission for the host.",
    seam: "tearleads.organizations facade",
    paths: [`${sdk}/client/organizations/`],
    surface: organizationClientSurface,
  },
  {
    name: "Blob Storage Client",
    package: "client-sdk",
    responsibility:
      "The tearleads.blobs facade: active blob store selection for the host.",
    seam: "tearleads.blobs facade",
    paths: [`${sdk}/client/blobs/`],
    surface: blobStorageClientSurface,
  },
  {
    name: "Device-First Sync Client",
    package: "client-sdk",
    responsibility:
      "The tearleads.deviceFirst facade: device-first local projection and background reconciliation for the host.",
    seam: "tearleads.deviceFirst facade",
    paths: [`${sdk}/client/deviceFirst/`],
    surface: deviceFirstClientSurface,
  },
  {
    name: "Identity & Session Client",
    package: "client-sdk",
    responsibility:
      "The tearleads.identity/session/userIdentities facades: identity keypairs, sessions, and auth context for the host.",
    seam: "tearleads.identity/session/userIdentities facades",
    paths: [`${sdk}/client/identity/`, `${sdk}/client/session/`],
    surface: identitySessionClientSurface,
  },
  {
    name: "Security Incident Client",
    package: "client-sdk",
    responsibility:
      "The tearleads.securityIncidents facade: incident listing and host notifications.",
    seam: "tearleads.securityIncidents facade; onSecurityIncident callback",
    paths: [`${sdk}/client/securityIncidents/`],
    surface: securityIncidentClientSurface,
  },
  {
    name: "Container Contents",
    package: "client-sdk",
    responsibility:
      "Container tree projections, container metadata documents, document discovery/links/queries, blob info, sync-state read models for product UI, and their SQLite persistence.",
    seam: "workflows/container-contents",
    paths: [
      `${sdk}/workflows/container-contents/`,
      `${sdk}/data/persistence/container-contents/`,
      `${sdk}/stores/container-contents/`,
    ],
    surface: containerContentsSurface,
    tables: containerContentsTables,
    readableTables: containerContentsReadableTables,
  },
  {
    name: "Container Data",
    package: "client-sdk",
    responsibility:
      "Client-side container CRUD/share workflow operations and principal-container rematerialization.",
    seam: "workflows/containers",
    paths: [`${sdk}/workflows/containers/`, `${sdk}/data/containers/`],
    surface: containerDataSurface,
  },
  {
    name: "Client Blob Storage",
    package: "client-sdk",
    responsibility:
      "Active blob store selection (ephemeral vs identity-namespaced), OPFS/memory byte stores, encrypted envelopes, attachment content crypto and events, and blob workflow operations.",
    seam: "workflows/blobs; blobContracts",
    paths: [`${sdk}/workflows/blobs/`, `${sdk}/data/blobs/`],
    surface: blobStorageSurface,
  },
  {
    name: "Organization Read Models",
    package: "client-sdk",
    responsibility:
      "Org directory/groups/grants/usage/user-detail read models and their SQLite persistence, roster/profile mutations, and group container shares for the client.",
    seam: "workflows/organizations",
    paths: [
      `${sdk}/workflows/organizations/`,
      `${sdk}/data/persistence/organizations/`,
    ],
    surface: organizationReadModelSurface,
    tables: organizationReadModelTables,
  },
  {
    name: "Root Console Client",
    package: "client-sdk",
    responsibility:
      "Root-only identity, organization, roster, billing, data usage, ops-health, RevenueCat webhook, and audit trail lookups and identity suspension, gated by the session's server-reported root flag.",
    seam: "tearleads.root facade; workflows/root",
    paths: [`${sdk}/workflows/root/`, `${sdk}/client/root/`],
    surface: rootConsoleSurface,
  },
  {
    name: "Principal Policy (client)",
    package: "client-sdk",
    responsibility:
      "Client-side principal policy workflow operations, admin-signer resolution, principal-policy crypto helpers, and their SQLite persistence.",
    seam: "workflows/principals",
    paths: [
      `${sdk}/workflows/principals/`,
      `${sdk}/data/principals/`,
      `${sdk}/data/persistence/principalCurrentAcknowledgementPersistence.ts`,
      `${sdk}/data/persistence/principalHistory/`,
      `${sdk}/data/persistence/principalKeys/`,
      `${sdk}/data/persistence/principalMutationJournalPersistence.ts`,
      `${sdk}/data/persistence/principalPolicy/`,
    ],
    surface: principalPolicySurface,
    tables: principalPolicyTables,
  },
  {
    name: "Client Registration",
    package: "client-sdk",
    responsibility:
      "Identity registration and the initial organization/root-container bootstrap performed from the client.",
    seam: "workflows/registration",
    paths: [`${sdk}/workflows/registration/`],
    surface: registrationSurface,
  },
  {
    name: "Sync Engine",
    package: "client-sdk",
    responsibility:
      "The per-DomainScope sync coordinator (lanes, phases, coalescing), device-first local projection + background reconciliation, and the scope/peer-seed primitives that drive cache invalidation.",
    seam: "sync workflow facade snapshots",
    paths: [
      `${sdk}/workflows/sync/`,
      `${sdk}/data/sync/`,
      `${sdk}/data/shared/domainScope.ts`,
      `${sdk}/sync/`,
      `${sdk}/stores/local-projection/`,
    ],
    surface: syncEngineSurface,
    tables: syncEngineTables,
  },
  {
    name: "Identity & Session",
    package: "client-sdk",
    responsibility:
      "Identity persistence and the TOFU-pinned user identity gateway.",
    seam: "TOFU gateway",
    paths: [
      `${sdk}/data/trustedUserIdentity/`,
      `${sdk}/data/persistence/identity/`,
    ],
    surface: identitySurface,
    tables: identityTables,
  },
  {
    name: "Local Keyring",
    package: "client-sdk",
    responsibility:
      "The on-device keyring (manifest storage, scopes, sessions) and its PIN-code unlock support.",
    seam: "createLocalKeyring / createBrowserLocalKeyring exports",
    paths: [`${sdk}/client/localKeyring/`],
    surface: localKeyringSurface,
  },
  {
    name: "Client Purchases",
    package: "client-sdk",
    responsibility:
      "Provider-agnostic purchase capabilities for org sync billing: the PurchasesCapability interface (provider-hosted flows) with the RevenueCat mapping core over an injectable backend, the DirectCheckoutCapability interface (an in-app payment element the app styles itself), and the unavailable stubs for both.",
    seam: "createRevenueCatPurchases / createUnavailablePurchases / createUnavailableDirectCheckout exports",
    paths: [`${sdk}/client/billing/`],
    surface: purchasesSurface,
  },
  {
    name: "SQLite Runtime",
    package: "client-sdk",
    responsibility:
      "The local SQLite executor, Drizzle schema, transaction serialization, and the @tearleads/client-sdk/sqlite public worker-runtime entry point.",
    seam: "@tearleads/client-sdk/sqlite subpath; data/sqlite",
    paths: [`${sdk}/data/sqlite/`, `${sdk}/sqlite/`],
  },
  {
    name: "Keying Verification",
    package: "client-sdk",
    responsibility:
      "Client-side cryptographic verification of server writer/access-manifest/link-set projections, canonical-record decode, access-level helpers, stable resource-id derivation, and the checkpoints and bindings it persists.",
    seam: "data/keyingProjectionVerification facade",
    paths: [
      `${sdk}/data/keyingProjectionVerification/`,
      `${sdk}/data/keying/`,
      `${sdk}/data/persistence/keyingCheckpoints/`,
      `${sdk}/data/persistence/organizationFounderPersistence.ts`,
      `${sdk}/data/persistence/verifiedManifestBundlePersistence.ts`,
      `${sdk}/data/persistence/verifiedCitations/`,
    ],
    surface: keyingVerificationSurface,
    tables: keyingVerificationTables,
  },
  {
    name: "Security Incident Detection",
    package: "client-sdk",
    responsibility:
      "Durable, redacted detection records for terminal client trust-boundary verification failures.",
    seam: "data/shared/securityIncidents",
    paths: [
      `${sdk}/data/shared/securityIncidents.ts`,
      `${sdk}/data/persistence/securityIncidentPersistence.ts`,
    ],
    surface: securityIncidentSurface,
    tables: securityIncidentTables,
  },
  {
    name: "SDK Shared Utilities",
    package: "client-sdk",
    responsibility:
      "Helpers every layer uses with no subsystem of their own: error messages, record readers, User Timing measures, the listener-set subscription primitive, timestamp selection, and the workflow runtime input contract.",
    seam: "direct import",
    paths: [
      `${sdk}/data/shared/dependencyUnavailable.ts`,
      `${sdk}/data/shared/errorMessage.ts`,
      `${sdk}/data/shared/recordReaders.ts`,
      `${sdk}/data/shared/userTiming.ts`,
      `${sdk}/data/shared/listenerSet.ts`,
      `${sdk}/data/persistence/latestTimestamp.ts`,
      `${sdk}/workflows/shared/`,
    ],
  },
  {
    name: "SDK Runtime & Composition Root",
    package: "client-sdk",
    responsibility:
      "The Tearleads facade that wires every SDK subsystem object, the runtime-snapshot projector, the SQLite database handle, the events/network/API-version state, logging, the platform I/O capability contracts (NetworkStatusSource, FileSaver), and the package root entry point.",
    seam: "new Tearleads(options); the package root index",
    paths: [
      `${sdk}/Tearleads.ts`,
      `${sdk}/TearleadsOptions.ts`,
      `${sdk}/client/index.ts`,
      `${sdk}/client/runtime/`,
      `${sdk}/client/host/`,
      `${sdk}/index.ts`,
    ],
    surface: runtimeRootSurface,
  },
];

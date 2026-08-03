import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  packageSourcePath,
  productionSourceFilePattern,
  testFilePattern,
} from "./dependencySourceRoots";

/**
 * A subsystem names a vertical slice or platform concern and indexes its paths.
 * It is not a dependency boundary. Import direction stays enforced by
 * `dependency-cruiser.config.ts` (lanes, layers, planes). A subsystem may span
 * several layers (e.g. Containers spans routes/, services/, and orchestration
 * workflows), which is exactly the scatter the registry makes greppable.
 *
 * See `docs/subsystems.md` for the human-facing table and AGENTS.md
 * "## Subsystems" for how this term relates to plane/layer/lane/facade.
 */
export interface Subsystem {
  /** Stable proper noun used in docs, PR descriptions, and conversation. */
  readonly name: string;
  /** Owning package short name (matches the keys in `packageSourcePath`). */
  readonly package: string;
  /** One-line statement of what the subsystem owns. */
  readonly responsibility: string;
  /** The public seam callers should reach for, in prose. */
  readonly seam: string;
  /**
   * Path prefixes (directories, written with a trailing `/`) and exact files the
   * subsystem owns. Across a registered package these must partition every
   * production source file with no overlaps and no gaps; the partition is
   * enforced by the `*-subsystem-registry-covers-every-source-file` lint check.
   */
  readonly paths: readonly string[];
}

const api = packageSourcePath.api;
const sdk = packageSourcePath.clientSdk;
const app = packageSourcePath.app;
export const subsystems: readonly Subsystem[] = [
  {
    name: "Containers",
    package: "api",
    responsibility:
      "Container CRUD, grant/revoke/rekey/move, accessible-container listing with sync paging, and writer-projection access resolution.",
    seam: "routes/containers via createContainerRouter; services/containers facade",
    paths: [
      `${api}/routes/containers/`,
      `${api}/services/containers/`,
      `${api}/workflows/containers/`,
    ],
  },
  {
    name: "Documents",
    package: "api",
    responsibility:
      "Document update storage, version-vector spans, commit LSN, audit entries/checkpoints/hash history, sync baseline redirect, and edit attribution.",
    seam: "routes/documents; services/documents facade",
    paths: [
      `${api}/routes/documents/`,
      `${api}/services/documents/`,
      `${api}/workflows/documents/`,
      `${api}/documents/`,
    ],
  },
  {
    name: "Blobs & Attachments",
    package: "api",
    responsibility:
      "Multipart blob staging, binary retrieval streaming, attachment binding, and the injectable blob object store (memory or S3).",
    seam: "routes/blobs; services/blobs facade; BlobObjectStore adapter",
    paths: [
      `${api}/routes/blobs/`,
      `${api}/services/blobs/`,
      `${api}/workflows/blobs/`,
      `${api}/adapters/blobObjectStore.ts`,
      `${api}/adapters/defaultBlobObjectStore.ts`,
      `${api}/adapters/s3BlobObjectStore.ts`,
      `${api}/adapters/s3BlobObjectStreams.ts`,
    ],
  },
  {
    name: "Organizations",
    package: "api",
    responsibility:
      "Org directory, profile, roster, groups, container grants, and data-usage read models and mutations.",
    seam: "routes/organizations; services/organizations facade",
    paths: [
      `${api}/routes/organizations/`,
      `${api}/services/organizations/`,
      `${api}/workflows/organizations/`,
    ],
  },
  {
    name: "Billing",
    package: "api",
    responsibility:
      "Per-organization billing lifecycle (local/trial/active), the free-sync trial, and the sync-eligibility gate that fronts server sync.",
    seam: "routes/billing via createBillingRouter; services/billing facade",
    paths: [
      `${api}/billing/`,
      `${api}/routes/billing/`,
      `${api}/services/billing/`,
      `${api}/workflows/billing/`,
    ],
  },
  {
    name: "Principals",
    package: "api",
    responsibility:
      "Principal policy projection and current-policy reads, principal state, and member-envelope writes for managed groups/organizations.",
    seam: "routes/principals; services/principals facade",
    paths: [
      `${api}/routes/principals/`,
      `${api}/services/principals/`,
      `${api}/workflows/principals/`,
      `${api}/workflows/regainedAccessTombstones.ts`,
    ],
  },
  {
    name: "Auth & Registration",
    package: "api",
    responsibility:
      "Challenge-response login, user registration, logout, session listing, and the websocket-ticket minting endpoint.",
    seam: "routes/auth; services/auth facade",
    paths: [
      `${api}/routes/auth/`,
      `${api}/services/auth/`,
      `${api}/workflows/auth/`,
    ],
  },
  {
    name: "Access Plane & Keying",
    package: "api",
    responsibility:
      "The encrypted access plane: signed access manifests, KEK state, content-key bundles, principal state, and the access-event/manifest projection codec.",
    seam: "access/read/*.ts and access/write/*.ts facades (composed only by workflows)",
    paths: [
      `${api}/access/`,
      `${api}/keyingProjectionRecords.ts`,
      `${api}/workflows/keyingReadAccess.ts`,
    ],
  },
  {
    name: "Realtime Sync",
    package: "api",
    responsibility:
      "Process-local fan-out of Redis pub/sub events to interested sockets: the WS lifecycle, interest index, Redis interest mirror, and upgrade tickets.",
    seam: "createRealtimeGateway, assembled and started by index.ts",
    paths: [
      `${api}/realtimeGateway.ts`,
      `${api}/wsConnection.ts`,
      `${api}/wsOrganizationRouting.ts`,
      `${api}/wsRouting.ts`,
      `${api}/wsInterestStore.ts`,
      `${api}/wsTicket.ts`,
      `${api}/wsIdentity.ts`,
    ],
  },
  {
    name: "Session Lifecycle",
    package: "api",
    responsibility:
      "Bearer-token session storage, activity/IP tracking, request-IP binding, and session revocation (clear WS interest + publish session_revoked).",
    seam: "middleware/session.ts (requireAuth) and sessionRevocation.ts",
    paths: [
      `${api}/middleware/session.ts`,
      `${api}/sessionRevocation.ts`,
      `${api}/validators/session.ts`,
      `${api}/requestContext.ts`,
    ],
  },
  {
    name: "Service Runtime & Composition Root",
    package: "api",
    responsibility:
      "The HTTP composition root: Hono app assembly, the ApiServiceRuntime dependency object, the test override seam, and the server entry point.",
    seam: "routeApp.ts / routeAppDeps.ts; ApiServiceRuntime from services/runtime.ts",
    paths: [
      `${api}/routeApp.ts`,
      `${api}/routeAppDeps.ts`,
      `${api}/corsOrigins.ts`,
      `${api}/index.ts`,
      `${api}/appTestRuntime.ts`,
      `${api}/services/runtime.ts`,
      `${api}/routes/health.ts`,
    ],
  },
  {
    name: "Infrastructure Adapters",
    package: "api",
    responsibility:
      "Effectful infrastructure boundaries other than blob storage: Redis key/value and pub/sub, plus the in-memory Redis used for tests and dev.",
    seam: "adapters/redis.ts, adapters/redisPubSub.ts (closed over by factories)",
    paths: [
      `${api}/adapters/redis.ts`,
      `${api}/adapters/redisPubSub.ts`,
      `${api}/adapters/inMemoryRedis.ts`,
    ],
  },
  {
    name: "Shared Utilities",
    package: "api",
    responsibility:
      "Package-neutral helpers reused across subsystems: array helpers, canonical JSON, SHA-256, SQL dialect, and UUID generation.",
    seam: "utils/* direct import",
    paths: [
      `${api}/utils/array.ts`,
      `${api}/utils/canonicalJson.ts`,
      `${api}/utils/record.ts`,
      `${api}/utils/sha256.ts`,
      `${api}/utils/sqlDialect.ts`,
      `${api}/utils/uuid.ts`,
    ],
  },
  {
    name: "Document Store & Sync",
    package: "client-sdk",
    responsibility:
      "Client-side document open/list/delete, the per-scope document store, document workflow operations, persisted-document registry, and document summary/sync contracts.",
    seam: "tearleads.documents facade; workflows/documents",
    paths: [
      `${sdk}/workflows/documents/`,
      `${sdk}/data/documents/`,
      `${sdk}/stores/documents/`,
      `${sdk}/client/documents.ts`,
      `${sdk}/documents.ts`,
      `${sdk}/data/documentSummary.ts`,
      `${sdk}/data/documentSync.ts`,
    ],
  },
  {
    name: "Container Contents",
    package: "client-sdk",
    responsibility:
      "Container tree projections, container metadata documents, document discovery/links/queries, blob info, and sync-state read models for product UI.",
    seam: "tearleads.containerContents facade; workflows/container-contents",
    paths: [
      `${sdk}/workflows/container-contents/`,
      `${sdk}/stores/container-contents/`,
      `${sdk}/client/containerContents.ts`,
      `${sdk}/client/containerContentsTypes.ts`,
    ],
  },
  {
    name: "Container Data",
    package: "client-sdk",
    responsibility:
      "Client-side container CRUD/share workflow operations and the local container persistence shape.",
    seam: "workflows/containers",
    paths: [`${sdk}/workflows/containers/`, `${sdk}/data/containers/`],
  },
  {
    name: "Client Blob Storage",
    package: "client-sdk",
    responsibility:
      "Active blob store selection (ephemeral vs identity-namespaced), OPFS/memory byte stores, encrypted envelopes, and blob workflow operations.",
    seam: "tearleads.blobs facade; workflows/blobs; blobContracts",
    paths: [
      `${sdk}/workflows/blobs/`,
      `${sdk}/data/blobs/`,
      `${sdk}/client/blobs.ts`,
      `${sdk}/data/blobContracts.ts`,
    ],
  },
  {
    name: "Organization Read Models",
    package: "client-sdk",
    responsibility:
      "Org directory/groups/grants/usage/user-detail read models, roster/profile mutations, and reserved-grant rewrap orchestration for the client.",
    seam: "tearleads.organizations facade; workflows/organizations",
    paths: [
      `${sdk}/workflows/organizations/`,
      `${sdk}/client/organizations.ts`,
      `${sdk}/client/organizationWorkflowRuntime.ts`,
      `${sdk}/client/organizationGroupPresentation.ts`,
      `${sdk}/client/organizationDataUsage.ts`,
      `${sdk}/client/organizationReadModels.ts`,
      `${sdk}/client/organizationMetadataReshare.ts`,
      `${sdk}/client/organizationMetadataReshareCoordinator.ts`,
      `${sdk}/client/organizationRootReshare.ts`,
      `${sdk}/client/organizationRootReshareCoordinator.ts`,
    ],
  },
  {
    name: "Principal Policy (client)",
    package: "client-sdk",
    responsibility:
      "Client-side principal policy workflow operations, admin-signer resolution, and principal-policy crypto helpers.",
    seam: "workflows/principals",
    paths: [
      `${sdk}/workflows/principals/`,
      `${sdk}/data/organizationAuthorityDescriptor.ts`,
      `${sdk}/data/principalPolicyAdminSigners.ts`,
      `${sdk}/data/principalPolicyCrypto.ts`,
    ],
  },
  {
    name: "Client Registration",
    package: "client-sdk",
    responsibility:
      "Identity registration and the initial organization/root-container bootstrap performed from the client.",
    seam: "workflows/registration",
    paths: [`${sdk}/workflows/registration/`],
  },
  {
    name: "Sync Engine",
    package: "client-sdk",
    responsibility:
      "The per-DomainScope sync coordinator (lanes, phases, coalescing), device-first local projection + background reconciliation, and the scope/peer-seed primitives that drive cache invalidation.",
    seam: "tearleads.deviceFirst facade; sync workflow facade snapshots",
    paths: [
      `${sdk}/workflows/sync/`,
      `${sdk}/data/sync/`,
      `${sdk}/sync/`,
      `${sdk}/stores/local-projection/`,
      `${sdk}/client/deviceFirst.ts`,
      `${sdk}/data/crdtPeerSeed.ts`,
      `${sdk}/data/databaseUnavailable.ts`,
      `${sdk}/data/domainScope.ts`,
    ],
  },
  {
    name: "Identity & Session",
    package: "client-sdk",
    responsibility: "Identity keys, sessions, and TOFU-pinned user identities.",
    seam: "identity/session/userIdentities; TOFU gateway",
    paths: [
      `${sdk}/client/identity.ts`,
      `${sdk}/client/identityKeyPackage.ts`,
      `${sdk}/client/session.ts`,
      `${sdk}/client/sessionIdentityTrust.ts`,
      `${sdk}/client/sessionTypes.ts`,
      `${sdk}/client/userIdentities.ts`,
      `${sdk}/data/trustedUserIdentity/`,
    ],
  },
  {
    name: "Local Keyring",
    package: "client-sdk",
    responsibility:
      "The on-device keyring (manifest storage, scopes, sessions) and its PIN-code unlock support.",
    seam: "createLocalKeyring / createBrowserLocalKeyring exports",
    paths: [
      `${sdk}/client/indexedDbStoreConnection.ts`,
      `${sdk}/client/localKeyring/`,
      `${sdk}/client/localKeyring.ts`,
      `${sdk}/client/localKeyringPinCode.ts`,
      `${sdk}/client/localKeyringPinCodeSupport.ts`,
    ],
  },
  {
    name: "Client Purchases",
    package: "client-sdk",
    responsibility:
      "Provider-agnostic purchase capabilities for org sync billing: the PurchasesCapability interface (provider-hosted flows) with the RevenueCat mapping core over an injectable backend, the DirectCheckoutCapability interface (an in-app payment element the app styles itself), and the unavailable stubs for both.",
    seam: "createRevenueCatPurchases / createUnavailablePurchases / createUnavailableDirectCheckout exports",
    paths: [
      `${sdk}/client/purchases.ts`,
      `${sdk}/client/revenueCatIdentity.ts`,
      `${sdk}/client/directCheckout.ts`,
    ],
  },
  {
    name: "SQLite Runtime",
    package: "client-sdk",
    responsibility:
      "The local SQLite executor, Drizzle schema, transaction serialization, and the @tearleads/client-sdk/sqlite public worker-runtime entry point.",
    seam: "@tearleads/client-sdk/sqlite subpath; data/sqlite",
    paths: [`${sdk}/data/sqlite/`, `${sdk}/sqlite.ts`],
  },
  {
    name: "Local Persistence",
    package: "client-sdk",
    responsibility:
      "Domain-specific SQLite read/write modules that take an explicit ExecSql executor (containers, container-contents, documents, principal policy).",
    seam: "data/persistence (consumed by workflows with ExecSql threaded in)",
    paths: [`${sdk}/data/persistence/`],
  },
  {
    name: "Keying Verification",
    package: "client-sdk",
    responsibility:
      "Client-side cryptographic verification of server writer/access-manifest/link-set projections, canonical-record decode, access-level helpers, and stable resource-id derivation.",
    seam: "data/keyingProjectionVerification facade",
    paths: [
      `${sdk}/data/keyingProjectionVerification/`,
      `${sdk}/data/keyingProjectionVerification.ts`,
      `${sdk}/data/keyingCanonicalJson.ts`,
      `${sdk}/data/accessLevel.ts`,
      `${sdk}/data/stableUuid.ts`,
    ],
  },
  {
    name: "SDK Runtime & Composition Root",
    package: "client-sdk",
    responsibility:
      "The Tearleads facade that wires every SDK subsystem object, the runtime-snapshot projector, the SQLite database handle, the events/network state, logging, the platform I/O capability contracts (NetworkStatusSource, FileSaver), and the package root entry point.",
    seam: "new Tearleads(options); the package root index",
    paths: [
      `${sdk}/client/Tearleads.ts`,
      `${sdk}/client/index.ts`,
      `${sdk}/client/rootContainerAdoption.ts`,
      `${sdk}/client/workflowRuntime.ts`,
      `${sdk}/client/database.ts`,
      `${sdk}/client/events.ts`,
      `${sdk}/client/network.ts`,
      `${sdk}/client/fileSaver.ts`,
      `${sdk}/client/syncBillingGate.ts`,
      `${sdk}/client/logger.ts`,
      `${sdk}/index.ts`,
      `${sdk}/workflows/runtimeInput.ts`,
    ],
  },
  {
    name: "Explorer",
    package: "app",
    responsibility:
      "The container/document explorer mini-app: tree, detail panels, sidebar windows, attribution, and its presentation store.",
    seam: "mini-apps/explorer; stores/explorer",
    paths: [`${app}/mini-apps/explorer/`, `${app}/stores/explorer/`],
  },
  {
    name: "Notes",
    package: "app",
    responsibility:
      "The notes mini-app: note editor, sidebar/context menus, and note presentation.",
    seam: "mini-apps/notes",
    paths: [`${app}/mini-apps/notes/`],
  },
  {
    name: "Contacts",
    package: "app",
    responsibility:
      "The contacts mini-app: contact list/detail UI and its presentation store.",
    seam: "mini-apps/contacts; stores/contacts",
    paths: [`${app}/mini-apps/contacts/`, `${app}/stores/contacts/`],
  },
  {
    name: "Org Manager",
    package: "app",
    responsibility:
      "The organization-management mini-app: directory, groups, grants, roster, and its presentation store.",
    seam: "mini-apps/org-manager; stores/org-manager",
    paths: [`${app}/mini-apps/org-manager/`, `${app}/stores/org-manager/`],
  },
  {
    name: "Identity Manager",
    package: "app",
    responsibility:
      "The identity-management mini-app: device keys, key-package backup, and identity UI.",
    seam: "mini-apps/identity-manager",
    paths: [`${app}/mini-apps/identity-manager/`],
  },
  {
    name: "System Monitor",
    package: "app",
    responsibility:
      "The system-monitor mini-app: runtime/sync/storage telemetry surfaces.",
    seam: "mini-apps/system-monitor",
    paths: [`${app}/mini-apps/system-monitor/`],
  },
  {
    name: "Backup & Restore",
    package: "app",
    responsibility:
      "The backup-and-restore mini-app: export/import of on-device state.",
    seam: "mini-apps/backup-restore",
    paths: [`${app}/mini-apps/backup-restore/`],
  },
  {
    name: "Mini-App Platform",
    package: "app",
    responsibility:
      "The window/mini-app host: app windows, the SDK-independent message bus, the app-shell-to-pane launcher bridge, the mini-app registry, the bootstrap/unlock gates, and shared cross-mini-app building blocks (e.g. the blob-pick host).",
    seam: "mini-apps/registry; mini-apps/bus; mini-apps/shared",
    paths: [
      `${app}/mini-apps/AppWindow.tsx`,
      `${app}/mini-apps/bus.tsx`,
      `${app}/mini-apps/LocalKeyringUnlockGate.tsx`,
      `${app}/mini-apps/miniAppLauncher.tsx`,
      `${app}/mini-apps/registry.ts`,
      `${app}/mini-apps/shared/`,
      `${app}/mini-apps/SystemBootstrapGate.tsx`,
      `${app}/mini-apps/types.ts`,
    ],
  },
  {
    name: "Document Types",
    package: "app",
    responsibility:
      "Shared document-type building blocks (note, contact, image, pdf, audio, file, cards) plus the type registry, importers, and projector definitions consumed by mini-apps.",
    seam: "document-types/registry; document-types/projectors",
    paths: [`${app}/document-types/`],
  },
  {
    name: "Document Projectors",
    package: "app",
    responsibility:
      "App-side client projections that derive structured document state (contact, credit-card, driver-license) for the projector registry.",
    seam: "document-projectors/appDocumentProjectors",
    paths: [`${app}/document-projectors/`],
  },
  {
    name: "App Shell & Components",
    package: "app",
    responsibility:
      "Reusable presentation: layout, pane, window, mini-app chrome, and shared components.",
    seam: "components/*",
    paths: [`${app}/components/`],
  },
  {
    name: "App Providers & Runtime",
    package: "app",
    responsibility:
      "The app composition root: the React provider stack (SDK, db, crypto, identity, events, host, local-keyring, logging, system-bootstrap), host config, and the app entry point.",
    seam: "providers/AppRuntimeProvider; App.tsx",
    paths: [
      `${app}/providers/`,
      `${app}/host/`,
      `${app}/App.tsx`,
      `${app}/client.tsx`,
    ],
  },
  {
    name: "Navigation",
    package: "app",
    responsibility:
      "App navigation: routed path navigation, history, mode/breakpoints, and mini-app route segments.",
    seam: "navigation/AppNavigationProvider",
    paths: [`${app}/navigation/`],
  },
  {
    name: "Theming",
    package: "app",
    responsibility:
      "Color themes: the theme registry, persisted selection, the `<html data-theme>` attribute stamp, and the footer theme toggle. The per-theme design-token blocks themselves live in @tearleads/ui's styles.css.",
    seam: "theme/ThemeProvider; theme/themes",
    paths: [`${app}/theme/`],
  },
  {
    name: "App Identity Provisioning",
    package: "app",
    responsibility:
      "App-level identity bootstrap: the identity autopilot, key-package backup, current-identity registration hooks, and the demo-only friendly peer bootstrap (auto-imported peer contact plus peer-labeled self/org names).",
    seam: "identity/IdentityAutopilot; identity/useRegisterCurrentIdentity; demo/DemoPeerBootstrap",
    paths: [`${app}/identity/`, `${app}/demo/`],
  },
  {
    name: "App Document & Device State",
    package: "app",
    responsibility:
      "App-side domain state machines for documents and device-first projection, plus the system-containers store and its org-aware Trash resolver.",
    seam: "stores/documents; stores/device-first",
    paths: [
      `${app}/stores/documents/`,
      `${app}/stores/device-first/`,
      `${app}/stores/systemContainers.ts`,
      `${app}/stores/systemContainerTrash.ts`,
    ],
  },
  {
    name: "App Utilities",
    package: "app",
    responsibility:
      "App-neutral presentation helpers: byte-length and date formatting, error-message normalization, and clipboard-safe billing traces.",
    seam: "utils/* direct import",
    paths: [`${app}/utils/`],
  },
];

/**
 * Source roots whose production files must each map to exactly one subsystem.
 * The registry is rolled out package by package; add a package's source path
 * here once every one of its production files is claimed in `subsystems`.
 */
export const registeredSubsystemSourcePaths: readonly string[] = [
  packageSourcePath.api,
  packageSourcePath.clientSdk,
  packageSourcePath.app,
];

/**
 * Product mini-app directory names, derived from the app subsystem rows so the
 * list cannot drift from what is on disk: the coverage check guarantees every
 * `mini-apps/<name>/` directory is claimed by a subsystem, so a newly added
 * mini-app appears here automatically. Consumed by `lintArchitecture.ts` to
 * build the mini-app bus boundary check.
 */
export const miniAppNames: readonly string[] = [
  ...new Set(
    subsystems
      .flatMap((subsystem) => subsystem.paths)
      // Match the first dir segment under mini-apps/ anywhere in the path (not
      // anchored at the end), so a future nested subsystem path like
      // mini-apps/explorer/detail/ still yields "explorer" rather than silently
      // dropping it. Exact files (mini-apps/bus.tsx) lack the trailing slash and
      // are correctly ignored.
      .map((path) => /\/mini-apps\/([^/]+)\//.exec(path)?.[1])
      .filter((name): name is string => name !== undefined),
  ),
].sort();

/** Subsystems that own the given production source file (ideally exactly one). */
export function subsystemsForFile(filePath: string): Subsystem[] {
  return subsystems.filter((subsystem) =>
    subsystem.paths.some((path) =>
      path.endsWith("/") ? filePath.startsWith(path) : filePath === path,
    ),
  );
}

async function listProductionSourceFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        return listProductionSourceFiles(entryPath);
      }

      return productionSourceFilePattern.test(entryPath) &&
        !testFilePattern.test(entryPath)
        ? [entryPath]
        : [];
    }),
  );

  return nestedFiles.flat();
}

export interface SubsystemCoverageViolation {
  filePath: string;
  matchedSubsystems: string[];
}

/**
 * Production files in a registered package that map to zero or more than one
 * subsystem. Surfaced by the `subsystem-registry-covers-every-source-file`
 * architecture check so a newly added file that finds no home fails lint.
 */
export async function findSubsystemCoverageViolations(): Promise<
  SubsystemCoverageViolation[]
> {
  const fileGroups = await Promise.all(
    registeredSubsystemSourcePaths.map(listProductionSourceFiles),
  );
  const sourceFiles = [...new Set(fileGroups.flat())].sort();

  return sourceFiles.flatMap((filePath) => {
    const matchedSubsystems = subsystemsForFile(filePath).map(
      (subsystem) => subsystem.name,
    );

    if (matchedSubsystems.length === 1) {
      return [];
    }

    return [{ filePath, matchedSubsystems }];
  });
}

const subsystemsDocsPath = "docs/subsystems.md";
const subsystemsDocsTableMarker = {
  end: "<!-- subsystems:end -->",
  start: "<!-- subsystems:start -->",
} as const;
const subsystemDocsRowPattern = /^\|\s*\*\*([^*]+)\*\*\s*\|/;

export interface SubsystemDocsViolation {
  detail: string;
  name: string;
}

/** Docs/manifest drift surfaced by `subsystem-registry-matches-docs`. */
export async function findSubsystemDocsViolations(): Promise<
  SubsystemDocsViolation[]
> {
  const content = await readFile(subsystemsDocsPath, "utf8");
  const startIndex = content.indexOf(subsystemsDocsTableMarker.start);
  const endIndex = content.indexOf(subsystemsDocsTableMarker.end);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return [
      {
        detail: `is missing the ${subsystemsDocsTableMarker.start} / ${subsystemsDocsTableMarker.end} registry markers`,
        name: subsystemsDocsPath,
      },
    ];
  }

  const tableSection = content.slice(startIndex, endIndex);
  const documentedNames = new Set(
    tableSection
      .split("\n")
      .map((line) => subsystemDocsRowPattern.exec(line)?.[1]?.trim())
      .filter((name): name is string => name !== undefined),
  );
  const manifestNames = new Set(subsystems.map((subsystem) => subsystem.name));

  const violations: SubsystemDocsViolation[] = [];
  for (const name of manifestNames) {
    if (!documentedNames.has(name)) {
      violations.push({
        detail:
          "is defined in scripts/subsystems.ts but has no row in the docs/subsystems.md registry table",
        name,
      });
    }
  }

  for (const name of documentedNames) {
    if (!manifestNames.has(name)) {
      violations.push({
        detail:
          "has a docs/subsystems.md registry row but is not defined in scripts/subsystems.ts",
        name,
      });
    }
  }

  return violations;
}

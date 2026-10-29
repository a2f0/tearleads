import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { clientSdkSubsystems } from "./clientSdkSubsystems";
import {
  packageSourcePath,
  productionSourceFilePattern,
  testFilePattern,
} from "./dependencySourceRoots";
import type { Subsystem } from "./subsystemTypes";

const api = packageSourcePath.api;
const app = packageSourcePath.app;
export const subsystems: readonly Subsystem[] = [
  {
    name: "Containers",
    package: "api",
    responsibility:
      "Container CRUD, grant/revoke/rekey/move, accessible-container listing with sync paging, and writer-projection access resolution.",
    seam: "routes/containers via createContainersRouter; services/containers facade",
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
      "Document update storage, version-vector spans, commit LSN, rotation-baseline markers, sync baseline redirect, and edit attribution.",
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
      `${api}/adapters/s3BlobDownloadUrl.ts`,
      `${api}/adapters/s3BlobUploadUrl.ts`,
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
    name: "Root Administration",
    package: "api",
    responsibility:
      "Root-gated staff lookups of identities, activity, sessions, organizations, billing, synced data usage, RevenueCat webhook deliveries, and cross-organization billing maintenance health, plus suspension of non-root identities, each recorded in the root audit trail before it is answered, and the audit trail listing.",
    seam: "routes/root via createRootRouter; services/root facade; middleware/root.ts",
    paths: [
      `${api}/routes/root/`,
      `${api}/services/root/`,
      `${api}/workflows/root/`,
      `${api}/middleware/root.ts`,
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
      `${api}/keyingProjectionManifestRecords.ts`,
      `${api}/keyingProjectionRecords.ts`,
      `${api}/workflows/keyingReadAccess.ts`,
      `${api}/workflows/signerPublicKey.ts`,
    ],
  },
  {
    name: "Realtime Sync",
    package: "api",
    responsibility:
      "Process-local fan-out of published realtime events to interested sockets: the WS lifecycle, per-socket interest index, and upgrade tickets.",
    seam: "createRealtimeGateway, assembled and started by index.ts and the realtime hub Durable Object",
    paths: [
      `${api}/realtime/publishedRealtimeEvents.ts`,
      `${api}/realtime/realtimeGateway.ts`,
      `${api}/realtime/gatewayHibernation.ts`,
      `${api}/realtime/organizationInterestAuthorization.ts`,
      `${api}/realtime/containerInterestAccess.ts`,
      `${api}/realtime/containerInterestAuthorization.ts`,
      `${api}/realtime/containerInterestDependencies.ts`,
      `${api}/realtime/containerInterestQueries.ts`,
      `${api}/realtime/containerInterestRevalidation.ts`,
      `${api}/realtime/containerInterestTypes.ts`,
      `${api}/realtime/hintScoping.ts`,
      `${api}/realtime/wsConnection.ts`,
      `${api}/realtime/wsOrganizationRouting.ts`,
      `${api}/realtime/wsRouting.ts`,
      `${api}/realtime/wsTicket.ts`,
      `${api}/realtime/wsIdentity.ts`,
      `${api}/realtime/wsSessionLiveness.ts`,
    ],
  },
  {
    name: "Session Lifecycle",
    package: "api",
    responsibility:
      "Bearer-token session storage, activity/IP tracking with a suspended-account re-check, history request lifetime, request-IP binding, and session revocation (publish session_revoked).",
    seam: "middleware/session.ts (requireAuth) and realtime/sessionRevocation.ts",
    paths: [
      `${api}/middleware/requestIp.ts`,
      `${api}/middleware/requestLifetime.ts`,
      `${api}/utils/principalHistoryWork.ts`,
      `${api}/middleware/session.ts`,
      `${api}/middleware/sessionActivity.ts`,
      `${api}/middleware/userActivity.ts`,
      `${api}/middleware/userSuspension.ts`,
      `${api}/realtime/sessionRevocation.ts`,
      `${api}/validators/session.ts`,
    ],
  },
  {
    name: "Service Runtime & Composition Root",
    package: "api",
    responsibility:
      "The HTTP composition root: Hono app assembly, the ApiServiceRuntime dependency object, the test override seam, and the Bun development server entry point.",
    seam: "routeApp.ts / routeAppDeps.ts; ApiServiceRuntime from services/runtime.ts",
    paths: [
      `${api}/routeApp.ts`,
      `${api}/routeAppDeps.ts`,
      `${api}/apiPublicOrigin.ts`,
      `${api}/corsOrigins.ts`,
      `${api}/diagnostics/`,
      `${api}/index.ts`,
      `${api}/appTestRuntime.ts`,
      `${api}/services/databaseWorkflowService.ts`,
      `${api}/services/runtime.ts`,
      `${api}/routes/health.ts`,
      `${api}/routes/errorResponse.ts`,
      `${api}/validators/headers.ts`,
      `${api}/validators/jsonRequest.ts`,
      `${api}/validators/pathParams.ts`,
      `${api}/validators/queryParams.ts`,
      `${api}/validators/requestBodyTooLarge.ts`,
      `${api}/validators/schema.ts`,
    ],
  },
  {
    name: "Infrastructure Adapters",
    package: "api",
    responsibility:
      "Effectful infrastructure boundaries other than blob storage: the key/value and pub/sub surface backed by the Workers Durable Objects, or by in-process state for the local server and tests.",
    seam: "adapters/keyValueStore.ts, adapters/pubSub.ts (closed over by factories)",
    paths: [
      `${api}/adapters/keyValueStore.ts`,
      `${api}/adapters/inMemoryKeyValueStore.ts`,
      `${api}/adapters/pubSub.ts`,
    ],
  },
  {
    name: "Workers Runtime",
    package: "api",
    responsibility:
      "The Cloudflare Workers composition root: the fetch and scheduled entry, environment binding into process.env, the SQLite Durable Object key/value store, the realtime hub Durable Object that hosts the gateway, scheduled maintenance, and the Loro WebAssembly alias.",
    seam: "worker/index.ts (Wrangler main); adapters reach it through worker/environment.ts",
    paths: [`${api}/worker/`],
  },
  {
    name: "Shared Utilities",
    package: "api",
    responsibility:
      "Package-neutral helpers reused across subsystems: arrays, canonical JSON, cursor encoding, SHA-256, server secrets, manifest dependency traversal, bounded verification caching, SQL dialect, database error classification, and best-effort event publishing.",
    seam: "utils/* direct import",
    paths: [
      `${api}/utils/array.ts`,
      `${api}/utils/byteBudgetCache.ts`,
      `${api}/utils/canonicalJson.ts`,
      `${api}/utils/cursor.ts`,
      `${api}/utils/databaseErrors.ts`,
      `${api}/utils/publishBestEffort.ts`,
      `${api}/utils/record.ts`,
      `${api}/utils/serverSecrets.ts`,
      `${api}/utils/sha256.ts`,
      `${api}/utils/sqlDialect.ts`,
      `${api}/utils/storedAccessEventVerification.ts`,
      `${api}/utils/storedManifestGraph.ts`,
    ],
  },
  ...clientSdkSubsystems,
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
    name: "Root Console",
    package: "app",
    responsibility:
      "The root mini-app: identity and organization directories, live sessions, account suspension, rosters, tabbed billing/history and data usage, RevenueCat webhook deliveries, organization usage, operations-health and RevenueCat webhook reports, and the root audit trail. Offered only to sessions the server reports as root.",
    seam: "mini-apps/root",
    paths: [`${app}/mini-apps/root/`],
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
    name: "Organizations Dashboard",
    package: "app",
    responsibility:
      "The organizations mini-app: every organization the user belongs to and the folders they can reach in each, independent of the active workspace.",
    seam: "mini-apps/organizations",
    paths: [`${app}/mini-apps/organizations/`],
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
      "The window/mini-app host: the mini-app registry and its windowing launcher definition, the SDK-independent message bus, the app-shell-to-pane launcher bridge, the bootstrap/unlock gates, and shared cross-mini-app building blocks (e.g. the blob-pick host).",
    seam: "mini-apps/registry; mini-apps/bus; mini-apps/shared",
    paths: [
      `${app}/mini-apps/AppWindow.tsx`,
      `${app}/mini-apps/bus.tsx`,
      `${app}/mini-apps/catalog.ts`,
      `${app}/mini-apps/LocalKeyringUnlockGate.tsx`,
      `${app}/mini-apps/miniAppLauncher.tsx`,
      `${app}/mini-apps/miniAppVisibility.ts`,
      `${app}/mini-apps/registry.ts`,
      `${app}/mini-apps/shared/`,
      `${app}/mini-apps/SystemBootstrapGate.tsx`,
      `${app}/mini-apps/types.ts`,
      `${app}/mini-apps/useVisibleMiniAppItems.ts`,
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
    name: "App Shell",
    package: "app",
    responsibility:
      "The app's shells: layout and workspaces, the windowed pane that hosts mini-app windows and its footer taskbar, and the routed shell's chrome. Composes the runtime, navigation, and the mini-apps it renders.",
    seam: "shell/layout/Layout; shell/pane/shell/Pane",
    paths: [`${app}/shell/`],
  },
  {
    name: "Shared Components",
    package: "app",
    responsibility:
      "Reusable presentation below the shells: the mini-app UI kit (controls, tables, overlays, the error boundary) and shared components. Loads no mini-app.",
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
      "App navigation: windowing's launcher navigation for mini-app ids, the mode switch, and touch row sizing.",
    seam: "navigation/AppNavigationProvider",
    paths: [`${app}/navigation/`],
  },
  {
    name: "Theming",
    package: "app",
    responsibility:
      "Color themes: the app's theme list for windowing's ThemeProvider (persisted selection, the `<html data-theme>` stamp) and the footer toggle. The per-theme token blocks live in @tearleads/ui's styles.css.",
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
          "is defined in scripts/architecture/subsystems.ts but has no row in the docs/subsystems.md registry table",
        name,
      });
    }
  }

  for (const name of documentedNames) {
    if (!manifestNames.has(name)) {
      violations.push({
        detail:
          "has a docs/subsystems.md registry row but is not defined in scripts/architecture/subsystems.ts",
        name,
      });
    }
  }

  return violations;
}

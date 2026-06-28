import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { packageSourcePath } from "./dependencySourceRoots";

/**
 * A subsystem is a DESCRIPTIVE proper noun for a vertical slice (or a horizontal
 * platform concern) that a developer reasons about as one unit. The registry is
 * a navigation/ownership index over paths that already exist; it is NOT a new
 * dependency-direction boundary. Import direction stays enforced by
 * `dependency-cruiser.config.ts` (lanes, layers, planes). A subsystem may span
 * several layers (e.g. Containers spans routes/, services/, and orchestration
 * workflows), which is exactly the scatter the registry makes greppable.
 *
 * See `docs/SUBSYSTEMS.md` for the human-facing table and AGENTS.md
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
      "Document update storage, spans/prune/compaction, commit LSN, audit entries/checkpoints/hash history, sync baseline redirect, and edit attribution.",
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
      "Blob staging (single + multipart), retrieval streaming, upload capabilities, attachment binding, and the injectable blob object store (memory or S3).",
    seam: "routes/blobs; services/blobs facade; BlobObjectStore adapter",
    paths: [
      `${api}/routes/blobs/`,
      `${api}/services/blobs/`,
      `${api}/workflows/blobs/`,
      `${api}/adapters/blobObjectStore.ts`,
      `${api}/adapters/defaultBlobObjectStore.ts`,
      `${api}/adapters/s3BlobObjectStore.ts`,
      `${api}/adapters/s3BlobObjectStreams.ts`,
      `${api}/utils/blobStageRecords.ts`,
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
    name: "Principals",
    package: "api",
    responsibility:
      "Principal policy projection and current-policy reads, principal state, and member-envelope writes for managed groups/organizations.",
    seam: "routes/principals; services/principals facade",
    paths: [
      `${api}/routes/principals/`,
      `${api}/services/principals/`,
      `${api}/workflows/principals/`,
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
    name: "Accounts",
    package: "api",
    responsibility:
      "Account lifecycle and paid-account tier gating used to authorize billed routes.",
    seam: "services/accounts facade; requirePaidAccount middleware",
    paths: [
      `${api}/services/accounts/`,
      `${api}/workflows/accounts/`,
      `${api}/accounts/`,
      `${api}/middleware/account.ts`,
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
      `${api}/utils/sha256.ts`,
      `${api}/utils/sqlDialect.ts`,
      `${api}/utils/uuid.ts`,
    ],
  },
];

/**
 * Source roots whose production files must each map to exactly one subsystem.
 * The registry is rolled out package by package; add a package's source path
 * here once every one of its production files is claimed in `subsystems`.
 */
export const registeredSubsystemSourcePaths: readonly string[] = [
  packageSourcePath.api,
];

/** Subsystems that own the given production source file (ideally exactly one). */
export function subsystemsForFile(filePath: string): Subsystem[] {
  return subsystems.filter((subsystem) =>
    subsystem.paths.some((path) =>
      path.endsWith("/") ? filePath.startsWith(path) : filePath === path,
    ),
  );
}

const productionSourceFilePattern = /\.[cm]?[tj]sx?$/;
const testFilePattern = /\.test\.[tj]sx?$/;

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

const subsystemsDocsPath = "docs/SUBSYSTEMS.md";
const subsystemsDocsTableMarker = {
  end: "<!-- subsystems:end -->",
  start: "<!-- subsystems:start -->",
} as const;
const subsystemDocsRowPattern = /^\|\s*\*\*(?<name>[^*]+)\*\*\s*\|/;

export interface SubsystemDocsViolation {
  detail: string;
  name: string;
}

/**
 * Drift between the `docs/SUBSYSTEMS.md` registry table and the manifest above.
 * Surfaced by the `subsystem-registry-matches-docs` architecture check.
 */
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
      .map((line) => subsystemDocsRowPattern.exec(line)?.groups?.name?.trim())
      .filter((name): name is string => name !== undefined),
  );
  const manifestNames = new Set(subsystems.map((subsystem) => subsystem.name));

  const violations: SubsystemDocsViolation[] = [];

  for (const name of manifestNames) {
    if (!documentedNames.has(name)) {
      violations.push({
        detail:
          "is defined in scripts/subsystems.ts but has no row in the docs/SUBSYSTEMS.md registry table",
        name,
      });
    }
  }

  for (const name of documentedNames) {
    if (!manifestNames.has(name)) {
      violations.push({
        detail:
          "has a docs/SUBSYSTEMS.md registry row but is not defined in scripts/subsystems.ts",
        name,
      });
    }
  }

  return violations;
}

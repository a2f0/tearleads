import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import { documents } from "@tearleads/api-shared/schema";
import type {
  AccessManifest,
  DocumentLinkSetManifestState,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  DocumentNotFoundErrorCode,
  DocumentProjectionErrorCode,
  DocumentSyncErrorCode,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  DOCUMENT_PROJECTION_ERROR_CODES,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  getAccessManifestBundle,
  getAccessManifestBundles,
  getCurrentAccessManifestHead,
} from "../../access/read/accessManifestStore";
import {
  DocumentContentKeyBundleError,
  getLatestDocumentContentKeyBundleProjection,
} from "../../access/read/documentContentKeyStore";
import {
  DocumentKekTargetError,
  resolveCurrentDocumentKekTargets,
} from "../../access/read/documentKekTargets";
import { recordDocumentManifestObservationInTransaction } from "../../access/write/documentManifestObservationStore";
import { createProjectionReaders } from "../../keyingProjectionRecords";
import { uniqueSortedStrings } from "../../utils/array";
import {
  type ContainerWriterProjectionContext,
  createContainerWriterProjectionContext,
} from "../containers/writerProjection";
import {
  toContentKeyBundleResponse,
  toDocumentKekTargetsResponse,
} from "./mutations/shared/records";
import {
  StoredDocumentManifestError,
  verifyStoredDocumentManifest,
} from "./storedDocumentManifestVerification";
import { resolveAuthorizingContainerPathCandidates } from "./writerProjectionContainerPaths";

type DocumentWriterProjectionStatus = 403 | 404 | 409;

export class DocumentWriterProjectionError extends Error {
  readonly code?:
    | DocumentNotFoundErrorCode
    | DocumentProjectionErrorCode
    | DocumentSyncErrorCode
    | undefined;

  constructor(
    message: string,
    readonly status: DocumentWriterProjectionStatus,
    code?:
      | DocumentNotFoundErrorCode
      | DocumentProjectionErrorCode
      | DocumentSyncErrorCode
      | undefined,
  ) {
    super(message);
    this.name = "DocumentWriterProjectionError";
    // Every 409 must carry a stable code — an uncoded conflict is
    // undiagnosable from a System Monitor report. Malformed stored state is
    // the fail-safe class for paths that do not name a more specific one.
    this.code =
      code ??
      (status === 409
        ? DOCUMENT_PROJECTION_ERROR_CODES.stateInvalid
        : undefined);
  }
}

function projectionError(message: string): DocumentWriterProjectionError {
  return new DocumentWriterProjectionError(message, 409);
}

const {
  accessManifestRecord,
  readCanonicalRecord,
  readNullableString,
  readPlainRecord,
  readStringArray,
  readValue,
  verifiedAccessEventRecord,
} = createProjectionReaders(projectionError);

function toAccessManifestBundleWireResponse(
  input: NonNullable<Awaited<ReturnType<typeof getAccessManifestBundle>>>,
): AccessManifestBundleWireResponse {
  return {
    event: verifiedAccessEventRecord(input.event),
    manifest: accessManifestRecord(input.manifest),
    manifestHash: input.manifestHash,
    state: readCanonicalRecord(input.state, "Document manifest state"),
  };
}

async function loadCurrentDocumentManifestBundle(
  executor: DatabaseSession,
  documentId: string,
): Promise<AccessManifestBundleWireResponse> {
  const head = await getCurrentAccessManifestHead(
    "document",
    documentId,
    executor,
  );
  if (!head) {
    // A missing head alone is not proof of deletion — only the documents row
    // is. Clients tear down their local copy on the coded 404, so emit it
    // solely when the row is positively absent; a headless-but-present row is
    // an anomalous state that must surface as a conflict, never as a wipe.
    const [document] = await executor
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    if (!document) {
      throw new DocumentWriterProjectionError(
        "Document not found",
        404,
        DOCUMENT_NOT_FOUND_ERROR_CODE,
      );
    }
    throw new DocumentWriterProjectionError(
      "Document manifest head missing",
      409,
      DOCUMENT_PROJECTION_ERROR_CODES.headMissing,
    );
  }

  const bundle = await getAccessManifestBundle(head.manifestHash, executor);
  if (!bundle || bundle.manifest.objectKind !== "document") {
    throw new DocumentWriterProjectionError(
      "Document manifest bundle missing",
      409,
    );
  }

  return toAccessManifestBundleWireResponse(bundle);
}

export interface LoadedProjectionManifestBundle {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly objectKind: AccessManifest["objectKind"];
}

export async function loadProjectionManifestBundleByHash(
  executor: DatabaseSession,
  manifestHash: string,
  cache: Map<string, LoadedProjectionManifestBundle>,
): Promise<LoadedProjectionManifestBundle> {
  const cached = cache.get(manifestHash);
  if (cached) {
    return cached;
  }

  const bundle = await getAccessManifestBundle(manifestHash, executor);
  if (!bundle) {
    throw new DocumentWriterProjectionError(
      "Access manifest dependency missing",
      409,
    );
  }

  const loaded = {
    bundle: toAccessManifestBundleWireResponse(bundle),
    objectKind: bundle.manifest.objectKind,
  };
  cache.set(manifestHash, loaded);

  return loaded;
}

async function loadProjectionManifestBundlesByHash(input: {
  readonly executor: DatabaseSession;
  readonly manifestHashes: readonly string[];
  readonly cache: Map<string, LoadedProjectionManifestBundle>;
}): Promise<LoadedProjectionManifestBundle[]> {
  const uniqueManifestHashes = uniqueSortedStrings(input.manifestHashes);
  const missingManifestHashes = uniqueManifestHashes.filter(
    (manifestHash) => !input.cache.has(manifestHash),
  );
  if (missingManifestHashes.length > 0) {
    const bundles = await getAccessManifestBundles(
      missingManifestHashes,
      input.executor,
    );
    for (const manifestHash of missingManifestHashes) {
      const bundle = bundles.get(manifestHash);
      if (!bundle) {
        throw new DocumentWriterProjectionError(
          "Access manifest dependency missing",
          409,
        );
      }

      input.cache.set(manifestHash, {
        bundle: toAccessManifestBundleWireResponse(bundle),
        objectKind: bundle.manifest.objectKind,
      });
    }
  }

  const loadedBundles: LoadedProjectionManifestBundle[] = [];
  for (const manifestHash of uniqueManifestHashes) {
    const loaded = input.cache.get(manifestHash);
    if (!loaded) {
      throw new DocumentWriterProjectionError(
        "Access manifest dependency missing",
        409,
      );
    }
    loadedBundles.push(loaded);
  }

  return loadedBundles;
}

function readManifestPreviousManifestHash(
  bundle: AccessManifestBundleWireResponse,
  label: string,
): string | null {
  const manifest = readPlainRecord(bundle.manifest, `${label} manifest`);

  return readNullableString(manifest, "previousManifestHash", label);
}

function readContainerParentManifestHash(
  bundle: AccessManifestBundleWireResponse,
  label: string,
): string | null {
  const state = readPlainRecord(bundle.state, `${label} state`);

  return readNullableString(state, "parentManifestHash", label);
}

function readEventDependencyManifestHashes(
  bundle: AccessManifestBundleWireResponse,
  label: string,
): string[] {
  const eventBundle = readPlainRecord(bundle.event, `${label} event bundle`);
  const event = readPlainRecord(
    readValue(eventBundle, "event"),
    `${label} event`,
  );

  return readStringArray(
    readValue(event, "dependencyManifestHashes"),
    `${label} event dependencyManifestHashes`,
  );
}

function collectDocumentDependencyManifestHashes(
  bundles: readonly AccessManifestBundleWireResponse[],
): string[] {
  const manifestHashes = new Set<string>();
  for (const [index, bundle] of bundles.entries()) {
    for (const manifestHash of readEventDependencyManifestHashes(
      bundle,
      index === 0
        ? "Document writer projection manifest"
        : `Document writer projection manifest history[${index - 1}]`,
    )) {
      manifestHashes.add(manifestHash);
    }
  }

  return [...manifestHashes].sort();
}

export async function loadDocumentManifestHistory(input: {
  readonly documentManifest: AccessManifestBundleWireResponse;
  readonly executor: DatabaseSession;
  readonly manifestCache: Map<string, LoadedProjectionManifestBundle>;
}): Promise<AccessManifestBundleWireResponse[]> {
  const documentManifestHistory: AccessManifestBundleWireResponse[] = [];
  const visitedDocumentHashes = new Set([input.documentManifest.manifestHash]);
  let previousDocumentManifestHash = readManifestPreviousManifestHash(
    input.documentManifest,
    "Document writer projection manifest",
  );
  while (previousDocumentManifestHash) {
    if (visitedDocumentHashes.has(previousDocumentManifestHash)) {
      throw new DocumentWriterProjectionError(
        "Document manifest history contains a cycle",
        409,
      );
    }
    visitedDocumentHashes.add(previousDocumentManifestHash);
    const loaded = await loadProjectionManifestBundleByHash(
      input.executor,
      previousDocumentManifestHash,
      input.manifestCache,
    );
    if (loaded.objectKind !== "document") {
      throw new DocumentWriterProjectionError(
        "Document manifest predecessor has the wrong object kind",
        409,
      );
    }
    documentManifestHistory.push(loaded.bundle);
    previousDocumentManifestHash = readManifestPreviousManifestHash(
      loaded.bundle,
      "Document writer projection manifest history",
    );
  }

  return documentManifestHistory;
}

interface ContainerDependencyMaterial {
  readonly documentContainerManifestHistory: AccessManifestBundleWireResponse[];
  readonly documentManifestContainerPaths: AccessManifestBundleWireResponse[][];
}

export interface ContainerDependencyLoadState {
  readonly containerHistoryByHash: Map<
    string,
    AccessManifestBundleWireResponse
  >;
  readonly containerPathsByLeafHash: Map<
    string,
    AccessManifestBundleWireResponse[]
  >;
  readonly executor: DatabaseSession;
  readonly manifestCache: Map<string, LoadedProjectionManifestBundle>;
  readonly walkedCitations: Set<string>;
  readonly walkedContainerPredecessors: Set<string>;
}

async function loadContainerHistoryBundle(
  state: ContainerDependencyLoadState,
  manifestHash: string,
): Promise<AccessManifestBundleWireResponse> {
  const loaded = await loadProjectionManifestBundleByHash(
    state.executor,
    manifestHash,
    state.manifestCache,
  );
  if (loaded.objectKind !== "container") {
    throw new DocumentWriterProjectionError(
      "Container manifest history entry has the wrong object kind",
      409,
    );
  }
  state.containerHistoryByHash.set(loaded.bundle.manifestHash, loaded.bundle);
  return loaded.bundle;
}

/**
 * A container event cites the ancestor heads it was committed against, which
 * may be neither on the current path nor any manifest's pin once the parent
 * advanced or the container moved. The client authorizes the event against
 * those cited heads, so every history manifest's citations are served too,
 * along with their own predecessors and citations.
 */
async function collectContainerCitedHeads(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly state: ContainerDependencyLoadState;
}): Promise<void> {
  const pending = readEventDependencyManifestHashes(
    input.bundle,
    "Document writer projection container dependency",
  ).filter((manifestHash) => !input.state.walkedCitations.has(manifestHash));
  for (const manifestHash of pending) {
    input.state.walkedCitations.add(manifestHash);
    const bundle =
      input.state.containerHistoryByHash.get(manifestHash) ??
      (await loadContainerHistoryBundle(input.state, manifestHash));
    await collectContainerDependencyPredecessors({
      bundle,
      state: input.state,
    });
    await collectContainerCitedHeads({ bundle, state: input.state });
  }
}

async function collectContainerDependencyPredecessors(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly state: ContainerDependencyLoadState;
}): Promise<void> {
  let previousHash = readManifestPreviousManifestHash(
    input.bundle,
    "Document writer projection container dependency",
  );
  while (
    previousHash &&
    !input.state.walkedContainerPredecessors.has(previousHash)
  ) {
    input.state.walkedContainerPredecessors.add(previousHash);
    const bundle = await loadContainerHistoryBundle(input.state, previousHash);
    await collectContainerCitedHeads({ bundle, state: input.state });
    previousHash = readManifestPreviousManifestHash(
      bundle,
      "Document writer projection container dependency history",
    );
  }
}

export async function loadContainerDependencyPath(input: {
  readonly leafManifestHash: string;
  readonly state: ContainerDependencyLoadState;
}): Promise<void> {
  if (input.state.containerPathsByLeafHash.has(input.leafManifestHash)) {
    return;
  }

  const visitedPathHashes = new Set<string>();
  const path: AccessManifestBundleWireResponse[] = [];
  let manifestHash: string | null = input.leafManifestHash;
  while (manifestHash) {
    if (visitedPathHashes.has(manifestHash)) {
      throw new DocumentWriterProjectionError(
        "Container manifest path contains a cycle",
        409,
      );
    }
    visitedPathHashes.add(manifestHash);
    const loaded = await loadProjectionManifestBundleByHash(
      input.state.executor,
      manifestHash,
      input.state.manifestCache,
    );
    if (loaded.objectKind !== "container") {
      throw new DocumentWriterProjectionError(
        "Document manifest dependency has the wrong object kind",
        409,
      );
    }
    path.push(loaded.bundle);
    input.state.containerHistoryByHash.set(
      loaded.bundle.manifestHash,
      loaded.bundle,
    );
    await collectContainerDependencyPredecessors({
      bundle: loaded.bundle,
      state: input.state,
    });
    await collectContainerCitedHeads({
      bundle: loaded.bundle,
      state: input.state,
    });
    manifestHash = readContainerParentManifestHash(
      loaded.bundle,
      "Document writer projection container dependency",
    );
  }

  input.state.containerPathsByLeafHash.set(
    input.leafManifestHash,
    path.reverse(),
  );
}

export async function loadDocumentContainerDependencyMaterial(input: {
  readonly documentManifest: AccessManifestBundleWireResponse;
  readonly documentManifestHistory: readonly AccessManifestBundleWireResponse[];
  readonly executor: DatabaseSession;
  readonly manifestCache: Map<string, LoadedProjectionManifestBundle>;
}): Promise<ContainerDependencyMaterial> {
  const state: ContainerDependencyLoadState = {
    containerHistoryByHash: new Map<string, AccessManifestBundleWireResponse>(),
    containerPathsByLeafHash: new Map<
      string,
      AccessManifestBundleWireResponse[]
    >(),
    executor: input.executor,
    manifestCache: input.manifestCache,
    walkedCitations: new Set<string>(),
    walkedContainerPredecessors: new Set<string>(),
  };
  const documentBundles = [
    input.documentManifest,
    ...input.documentManifestHistory,
  ];
  const dependencies = await loadProjectionManifestBundlesByHash({
    cache: input.manifestCache,
    executor: input.executor,
    manifestHashes: collectDocumentDependencyManifestHashes(documentBundles),
  });

  for (const dependency of dependencies) {
    if (dependency.objectKind === "container") {
      await loadContainerDependencyPath({
        leafManifestHash: dependency.bundle.manifestHash,
        state,
      });
    }
  }

  return {
    documentManifestContainerPaths: [
      ...state.containerPathsByLeafHash.values(),
    ],
    documentContainerManifestHistory: [
      ...state.containerHistoryByHash.values(),
    ],
  };
}

async function loadDocumentWriterProjectionVerificationMaterial(input: {
  readonly documentManifest: AccessManifestBundleWireResponse;
  readonly executor: DatabaseSession;
}): Promise<
  Pick<
    DocumentWriterProjectionResponse,
    | "documentContainerManifestHistory"
    | "documentManifestContainerPaths"
    | "documentManifestHistory"
  >
> {
  const manifestCache = new Map<string, LoadedProjectionManifestBundle>();
  manifestCache.set(input.documentManifest.manifestHash, {
    bundle: input.documentManifest,
    objectKind: "document",
  });
  const documentManifestHistory = await loadDocumentManifestHistory({
    ...input,
    manifestCache,
  });
  const containerMaterial = await loadDocumentContainerDependencyMaterial({
    ...input,
    documentManifestHistory,
    manifestCache,
  });

  return {
    documentManifestHistory,
    ...containerMaterial,
  };
}

async function resolveAuthorizingContainerPaths(input: {
  readonly containerIds: readonly string[];
  readonly context: ContainerWriterProjectionContext;
  readonly executor: DatabaseSession;
  readonly userId: string;
}) {
  const candidates = await resolveAuthorizingContainerPathCandidates(input);
  if (candidates.paths.length === 0) {
    throw new DocumentWriterProjectionError("Forbidden", 403);
  }

  return candidates.paths;
}

async function resolveDocumentWriterProjection(input: {
  readonly documentId: string;
  readonly executor: DatabaseSession;
  readonly userId: string;
}): Promise<DocumentWriterProjectionResponse> {
  const documentManifest = await loadCurrentDocumentManifestBundle(
    input.executor,
    input.documentId,
  );
  const containerProjectionContext = createContainerWriterProjectionContext(
    input.executor,
  );
  let documentState: DocumentLinkSetManifestState;
  try {
    documentState = (
      await verifyStoredDocumentManifest({
        bundle: documentManifest,
        containerContext: containerProjectionContext,
      })
    ).state;
  } catch (error) {
    if (error instanceof StoredDocumentManifestError) {
      throw new DocumentWriterProjectionError(error.message, 409);
    }
    throw error;
  }
  let documentKekTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  let authorizingContainerPaths: Awaited<
    ReturnType<typeof resolveAuthorizingContainerPaths>
  >;
  try {
    // Run sequentially: this projection always executes inside a transaction,
    // so both reads share one pinned connection. Issuing them concurrently
    // only trips pg's already-executing-query deprecation without parallelism.
    documentKekTargets = await resolveCurrentDocumentKekTargets(
      input.documentId,
      input.executor,
    );
    authorizingContainerPaths = await resolveAuthorizingContainerPaths({
      containerIds: documentState.linkedContainerIds,
      context: containerProjectionContext,
      executor: input.executor,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof DocumentKekTargetError) {
      // The coded existence check above already ran, so a 404 here (e.g. a
      // link-set head that vanished mid-projection) is not proof of deletion;
      // keep it away from the client's 404-triggered wipe.
      throw new DocumentWriterProjectionError(
        error.message,
        error.status === 404 ? 409 : error.status,
        DOCUMENT_PROJECTION_ERROR_CODES.kekTargetsUnavailable,
      );
    }
    throw error;
  }
  let contentKeyBundle: Awaited<
    ReturnType<typeof getLatestDocumentContentKeyBundleProjection>
  >;
  try {
    contentKeyBundle = await getLatestDocumentContentKeyBundleProjection(
      {
        currentTargets: documentKekTargets,
        documentId: input.documentId,
      },
      input.executor,
    );
  } catch (error) {
    if (error instanceof DocumentContentKeyBundleError) {
      throw new DocumentWriterProjectionError(error.message, 409, error.code);
    }
    throw error;
  }

  if (!contentKeyBundle) {
    throw new DocumentWriterProjectionError(
      "Document content-key bundle missing",
      409,
      DOCUMENT_PROJECTION_ERROR_CODES.contentKeyBundleMissing,
    );
  }
  const verificationMaterial =
    await loadDocumentWriterProjectionVerificationMaterial({
      documentManifest,
      executor: input.executor,
    });

  return {
    documentId: input.documentId,
    documentManifest,
    ...verificationMaterial,
    documentKekTargets: toDocumentKekTargetsResponse(documentKekTargets),
    contentKeyBundle: toContentKeyBundleResponse(
      contentKeyBundle.bundle,
      projectionError,
    ),
    // A bundle wrapped to superseded KEK targets is served, not suppressed:
    // clients that span the rotation heal it by re-wrapping the content key
    // (a 409 here would deny them the current targets they need to do so).
    ...(contentKeyBundle.stale ? { contentKeyBundleStale: true as const } : {}),
    authorizingContainerPaths,
  };
}

export async function runDocumentWriterProjectionWorkflow(
  db: ApiDatabase,
  input: {
    readonly documentId: string;
    readonly userId: string;
  },
): Promise<DocumentWriterProjectionResponse> {
  return db.transaction(async (tx) => {
    const projection = await resolveDocumentWriterProjection({
      documentId: input.documentId,
      executor: tx,
      userId: input.userId,
    });
    await recordDocumentManifestObservationInTransaction(tx, {
      documentId: input.documentId,
      manifestHash: projection.documentManifest.manifestHash,
      userId: input.userId,
    });
    return projection;
  });
}

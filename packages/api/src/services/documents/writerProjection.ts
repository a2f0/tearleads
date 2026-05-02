import type {
  AccessManifest,
  DocumentLinkSetManifestState,
  KeyingCanonicalJson,
  VerifiedAccessEvent,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  ContainerWriterProjectionResponse,
  DocumentContentKeyBundleResponse,
  DocumentKekTargetsResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  getAccessManifestBundle,
  getAccessManifestBundles,
  getCurrentAccessManifestHead,
} from "../../access/read/accessManifestStore";
import {
  DocumentContentKeyBundleError,
  type DocumentContentKeyTargetEnvelope,
  getLatestCurrentDocumentContentKeyBundle,
} from "../../access/read/documentContentKeyStore";
import {
  DocumentKekTargetError,
  resolveCurrentDocumentKekTargets,
} from "../../access/read/documentKekTargets";
import type { DatabaseSession } from "../../adapters/postgres";
import {
  projectionAccessManifestRecord,
  projectionVerifiedAccessEventRecord,
  readProjectionNullableString,
  readProjectionPlainRecord,
  readProjectionPositiveInteger,
  readProjectionRecord,
  readProjectionString,
  readProjectionStringArray,
  readProjectionValue,
  readProjectionVersion,
} from "../../keyingProjectionRecords";
import {
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
  resolveContainerWriterProjection,
} from "../../workflows/containers/writerProjection";
import type { ApiServiceRuntime } from "../runtime";

type DocumentWriterProjectionStatus = 403 | 404 | 409;

export class DocumentWriterProjectionError extends Error {
  constructor(
    message: string,
    readonly status: DocumentWriterProjectionStatus,
  ) {
    super(message);
    this.name = "DocumentWriterProjectionError";
  }
}

function projectionError(message: string): DocumentWriterProjectionError {
  return new DocumentWriterProjectionError(message, 409);
}

function readPlainRecord(value: unknown, label: string) {
  return readProjectionPlainRecord(value, label, projectionError);
}

function readCanonicalRecord(value: KeyingCanonicalJson, label: string) {
  return readProjectionRecord(value, label, projectionError);
}

function readString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  return readProjectionString(record, key, label, projectionError);
}

function readNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  return readProjectionNullableString(record, key, label, projectionError);
}

function readPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  return readProjectionPositiveInteger(record, key, label, projectionError);
}

function readStringArray(value: unknown, label: string) {
  return readProjectionStringArray(value, label, projectionError);
}

function readVersion(record: Record<string, unknown>, label: string) {
  return readProjectionVersion(record, label, projectionError);
}

const readValue = readProjectionValue;
const accessManifestRecord = projectionAccessManifestRecord;
const verifiedAccessEventRecord = projectionVerifiedAccessEventRecord;

function toAccessManifestBundleWireResponse(input: {
  readonly event: VerifiedAccessEvent;
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  readonly state: KeyingCanonicalJson;
}): AccessManifestBundleWireResponse {
  return {
    event: verifiedAccessEventRecord(input.event),
    manifest: accessManifestRecord(input.manifest),
    manifestHash: input.manifestHash,
    state: readCanonicalRecord(input.state, "Document manifest state"),
  };
}

function toDocumentKekTargetsResponse(
  targets: Awaited<ReturnType<typeof resolveCurrentDocumentKekTargets>>,
): DocumentKekTargetsResponse {
  return {
    documentId: targets.documentId,
    linkSetManifestHash: targets.linkSetManifestHash,
    linkedContainerManifestHashes: [...targets.linkedContainerManifestHashes],
    linkedContainerKeyEpochIds: [...targets.linkedContainerKeyEpochIds],
    targets: targets.targets.map((target) => ({ ...target })),
    documentKeyTargetHash: targets.documentKeyTargetHash,
  };
}

function toContentKeyBundleResponse(input: {
  readonly bundle: {
    readonly documentId: string;
    readonly contentKeyEpoch: number;
    readonly linkSetManifestHash: string;
    readonly targetHash: string;
    readonly targets: readonly DocumentContentKeyTargetEnvelope[];
  };
}): DocumentContentKeyBundleResponse {
  return {
    documentId: input.bundle.documentId,
    contentKeyEpoch: input.bundle.contentKeyEpoch,
    linkSetManifestHash: input.bundle.linkSetManifestHash,
    targetHash: input.bundle.targetHash,
    targets: input.bundle.targets.map((target) => ({
      containerId: target.containerId,
      containerManifestHash: target.containerManifestHash,
      containerKeyEpochId: target.containerKeyEpochId,
      containerKeyEpoch: target.containerKeyEpoch,
      wrappedKey: target.wrappedKey,
      wrappingMetadata: readCanonicalRecord(
        target.wrappingMetadata,
        "Document content-key target wrapping metadata",
      ),
    })),
  };
}

function readDocumentLinkSetState(
  state: unknown,
): DocumentLinkSetManifestState {
  const record = readPlainRecord(state, "Document manifest state");
  readVersion(record, "Document manifest state");
  const linkedContainerIds = readStringArray(
    readValue(record, "linkedContainerIds"),
    "Document manifest state.linkedContainerIds",
  );

  return {
    version: 1,
    documentId: readString(record, "documentId", "Document manifest state"),
    organizationId: readString(
      record,
      "organizationId",
      "Document manifest state",
    ),
    epoch: readPositiveInteger(record, "epoch", "Document manifest state"),
    previousManifestHash: readNullableString(
      record,
      "previousManifestHash",
      "Document manifest state",
    ),
    eventHash: readString(record, "eventHash", "Document manifest state"),
    linkedContainerIds,
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
    throw new DocumentWriterProjectionError(
      "Document manifest head missing",
      404,
    );
  }

  const bundle = await getAccessManifestBundle(head.manifestHash, executor);
  if (!bundle || bundle.manifest.objectKind !== "document") {
    throw new DocumentWriterProjectionError(
      "Document manifest bundle missing",
      409,
    );
  }

  return toAccessManifestBundleWireResponse({
    event: bundle.event,
    manifest: bundle.manifest,
    manifestHash: bundle.manifestHash,
    state: bundle.state,
  });
}

interface LoadedProjectionManifestBundle {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly objectKind: AccessManifest["objectKind"];
}

async function loadProjectionManifestBundleByHash(
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
    bundle: toAccessManifestBundleWireResponse({
      event: bundle.event,
      manifest: bundle.manifest,
      manifestHash: bundle.manifestHash,
      state: bundle.state,
    }),
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
  const uniqueManifestHashes = [...new Set(input.manifestHashes)].sort();
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
        bundle: toAccessManifestBundleWireResponse({
          event: bundle.event,
          manifest: bundle.manifest,
          manifestHash: bundle.manifestHash,
          state: bundle.state,
        }),
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

async function loadDocumentManifestHistory(input: {
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

interface ContainerDependencyLoadState {
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
  readonly walkedContainerPredecessors: Set<string>;
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
    const loaded = await loadProjectionManifestBundleByHash(
      input.state.executor,
      previousHash,
      input.state.manifestCache,
    );
    if (loaded.objectKind !== "container") {
      throw new DocumentWriterProjectionError(
        "Container manifest predecessor has the wrong object kind",
        409,
      );
    }
    input.state.containerHistoryByHash.set(
      loaded.bundle.manifestHash,
      loaded.bundle,
    );
    previousHash = readManifestPreviousManifestHash(
      loaded.bundle,
      "Document writer projection container dependency history",
    );
  }
}

async function loadContainerDependencyPath(input: {
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

async function loadDocumentContainerDependencyMaterial(input: {
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
  const results = await Promise.all(
    input.containerIds.map(
      async (
        containerId,
      ): Promise<ContainerWriterProjectionResponse | null> => {
        try {
          return await resolveContainerWriterProjection({
            containerId,
            context: input.context,
            executor: input.executor,
            userId: input.userId,
          });
        } catch (error) {
          if (
            error instanceof ContainerWriterProjectionError &&
            error.status === 403
          ) {
            return null;
          }

          throw error;
        }
      },
    ),
  );
  const authorizingPaths = results.filter(
    (path): path is ContainerWriterProjectionResponse => path !== null,
  );

  if (authorizingPaths.length === 0) {
    throw new DocumentWriterProjectionError("Forbidden", 403);
  }

  return authorizingPaths;
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
  const documentState = readDocumentLinkSetState(documentManifest.state);
  const containerProjectionContext = createContainerWriterProjectionContext(
    input.executor,
  );
  let documentKekTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  let authorizingContainerPaths: Awaited<
    ReturnType<typeof resolveAuthorizingContainerPaths>
  >;
  try {
    [documentKekTargets, authorizingContainerPaths] = await Promise.all([
      resolveCurrentDocumentKekTargets(input.documentId, input.executor),
      resolveAuthorizingContainerPaths({
        containerIds: documentState.linkedContainerIds,
        context: containerProjectionContext,
        executor: input.executor,
        userId: input.userId,
      }),
    ]);
  } catch (error) {
    if (error instanceof DocumentKekTargetError) {
      throw new DocumentWriterProjectionError(error.message, error.status);
    }
    throw error;
  }
  let contentKeyBundle: Awaited<
    ReturnType<typeof getLatestCurrentDocumentContentKeyBundle>
  >;
  try {
    contentKeyBundle = await getLatestCurrentDocumentContentKeyBundle(
      {
        currentTargets: documentKekTargets,
        documentId: input.documentId,
      },
      input.executor,
    );
  } catch (error) {
    if (error instanceof DocumentContentKeyBundleError) {
      throw new DocumentWriterProjectionError(error.message, 409);
    }
    throw error;
  }

  if (!contentKeyBundle) {
    throw new DocumentWriterProjectionError(
      "Document content-key bundle missing",
      409,
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
    contentKeyBundle: toContentKeyBundleResponse({ bundle: contentKeyBundle }),
    authorizingContainerPaths,
  };
}

export async function getDocumentWriterProjection(
  runtime: ApiServiceRuntime,
  input: {
    readonly documentId: string;
    readonly userId: string;
  },
): Promise<DocumentWriterProjectionResponse> {
  return runtime.db.transaction((tx) =>
    resolveDocumentWriterProjection({
      documentId: input.documentId,
      executor: tx,
      userId: input.userId,
    }),
  );
}

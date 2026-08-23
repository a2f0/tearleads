import {
  type createContainerContentsStore as createExplorerStore,
  defaultDocumentsPersistence,
  defaultContainerContentsPersistence as defaultExplorerPersistence,
} from "@symcrypt/client-sdk";
import type { ExecSql } from "@symcrypt/client-sdk/sqlite";
import { computeAccessEventHash } from "@symcrypt/crypto";
import {
  createContainerMutationResponseFromRequest,
  createContainerWriterProjectionFixture,
} from "@symcrypt/test-utils";
import type {
  ContainerMutationRequest,
  DocumentCreateRequest,
  DocumentSyncRequest,
} from "@symcrypt/validators/request";
import type {
  AccessManifestBundleWireResponse,
  ContainerMutationResponse,
  ContainerSummary,
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentSyncResponse,
  ListContainersResponse,
} from "@symcrypt/validators/response";
import { isAccessManifestBundleWireResponse } from "@symcrypt/validators/util";
import { assertAccessEvent, assertWriteHeader } from "../keyingAssertions";

export type ExplorerRuntime = Parameters<typeof createExplorerStore>[0];
export type TestRuntime = ExplorerRuntime & { close: () => void };
export type ExplorerRuntimePatch = Partial<ExplorerRuntime> & {
  dbStatus?: ExplorerRuntime["infra"]["dbStatus"];
  encapsulationKeyPair?: ExplorerRuntime["crypto"]["encapsulationKeyPair"];
  isAuthenticated?: ExplorerRuntime["auth"]["isAuthenticated"];
  online?: ExplorerRuntime["state"]["online"];
  organizationId?: ExplorerRuntime["auth"]["organizationId"];
  signingFingerprint?: ExplorerRuntime["crypto"]["signingFingerprint"];
  signingKeyPair?: ExplorerRuntime["crypto"]["signingKeyPair"];
  userId?: ExplorerRuntime["auth"]["userId"];
};
export type ListedContainer = ContainerSummary;
type TestContainerRecord = Parameters<
  typeof defaultExplorerPersistence.saveContainer
>[1];
type ExplorerDocumentRecord = NonNullable<
  Parameters<typeof defaultExplorerPersistence.saveContainer>[2]
>;
type TestSaveContainerOptions = Parameters<
  typeof defaultExplorerPersistence.saveContainer
>[3];
export const TEST_SYNC_TIMESTAMP = "2026-05-05T00:00:00.000Z";

export function listedContainer(
  overrides: Omit<
    ContainerSummary,
    | "createdAt"
    | "depth"
    | "effectiveAccessLevel"
    | "metadataReferencedPrincipals"
    | "updatedAt"
  > &
    Partial<
      Pick<
        ContainerSummary,
        "createdAt" | "depth" | "metadataReferencedPrincipals" | "updatedAt"
      >
    >,
): ContainerSummary {
  return {
    createdAt: TEST_SYNC_TIMESTAMP,
    depth: overrides.parentId === null ? 0 : 1,
    effectiveAccessLevel: "admin",
    metadataReferencedPrincipals: [],
    updatedAt: TEST_SYNC_TIMESTAMP,
    ...overrides,
  };
}

export function listContainersResponse(
  items: ReadonlyArray<ContainerSummary> = [],
): ListContainersResponse {
  const lastItem = items.at(-1);
  return {
    hasMore: false,
    items: [...items],
    nextWatermark: lastItem
      ? { id: lastItem.id, updatedAt: lastItem.updatedAt }
      : null,
    tombstones: [],
  };
}

export function readSqlRowValue(
  row: Record<string, string | number | null>,
  key: string,
): string | number | null | undefined {
  return row[key];
}

export async function ensureContainerTables(execSql: ExecSql): Promise<void> {
  await defaultExplorerPersistence.ensureSchema(execSql);
}

export async function ensureDocumentTables(execSql: ExecSql): Promise<void> {
  await defaultDocumentsPersistence.ensureSchema(execSql);
}

export async function loadContainers(
  execSql: ExecSql,
): Promise<ReadonlyArray<TestContainerRecord>> {
  const storedContainers =
    await defaultExplorerPersistence.loadContainers(execSql);
  return storedContainers.map(({ container }) => container);
}

export async function saveContainer(
  execSql: ExecSql,
  container: TestContainerRecord,
  options?: TestSaveContainerOptions,
): Promise<TestContainerRecord> {
  return defaultExplorerPersistence.saveContainer(
    execSql,
    container,
    null,
    options,
  );
}

export async function saveDocumentRecord(
  execSql: ExecSql,
  scope: { appKind: string; localId: string },
  record: ExplorerDocumentRecord,
  updatedAt: string,
): Promise<void> {
  if (scope.appKind !== "container-metadata") {
    throw new Error(
      `Unsupported explorer test document scope ${scope.appKind}`,
    );
  }

  const container = (await loadContainers(execSql)).find(
    (candidate) => candidate.id === scope.localId,
  );
  if (!container) {
    throw new Error(
      `Cannot save metadata document for missing container ${scope.localId}.`,
    );
  }

  await defaultExplorerPersistence.saveContainer(execSql, container, record, {
    localUpdatedAt: updatedAt,
  });
}

export async function createExplorerMetadataContainerProjection(input: {
  containerId: string;
  encapsulationPublicKey: Uint8Array;
  organizationId: string;
  parentProjection?: ContainerWriterProjectionResponse;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  userId: string;
}): Promise<ContainerWriterProjectionResponse> {
  return createContainerWriterProjectionFixture({
    containerId: input.containerId,
    encapsulationPublicKey: input.encapsulationPublicKey,
    metadataDocumentId: `${input.containerId}-metadata-document`,
    organizationId: input.organizationId,
    parentProjection: input.parentProjection,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signerPrivateKey: input.signerPrivateKey,
    userId: input.userId,
  });
}

export async function createExplorerMetadataCreateResponse(
  request: DocumentCreateRequest,
): Promise<DocumentCreateResponse> {
  const manifest = request.manifest as Record<string, unknown>;
  const body = request.body as Record<string, unknown>;
  const documentId = String(Reflect.get(manifest, "objectId"));
  const event = assertAccessEvent(request.event, "metadata document event");
  const eventHash = await computeAccessEventHash(event);
  const linkedContainerId = String(Reflect.get(body, "containerId"));
  const targets = request.contentKeyBundle.targets.map((target) => ({
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
    containerKeyEpochId: target.containerKeyEpochId,
    containerKeyEpoch: target.containerKeyEpoch,
  }));

  return {
    id: documentId,
    createdAt: "2026-04-27T00:00:00.000Z",
    accessManifest: {
      event: { event: { ...event }, body, eventHash },
      manifest,
      manifestHash: request.expectedManifestHash,
      state: {
        version: 1,
        documentId,
        organizationId: String(Reflect.get(manifest, "organizationId")),
        epoch: Number(Reflect.get(manifest, "epoch")),
        previousManifestHash: Reflect.get(manifest, "previousManifestHash"),
        eventHash,
        linkedContainerIds: [linkedContainerId],
      },
    },
    contentKeyBundle: {
      documentId,
      contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch,
      linkSetManifestHash: request.contentKeyBundle.linkSetManifestHash,
      targetHash: request.contentKeyBundle.targetHash,
      targets: request.contentKeyBundle.targets,
    },
    documentKekTargets: {
      documentId,
      linkSetManifestHash: request.expectedManifestHash,
      linkedContainerManifestHashes: targets.map(
        (target) => target.containerManifestHash,
      ),
      linkedContainerKeyEpochIds: targets.map(
        (target) => target.containerKeyEpochId,
      ),
      targets,
      documentKeyTargetHash: request.contentKeyBundle.targetHash,
    },
  };
}

export async function createExplorerMetadataSyncResponse(input: {
  commitLsn: string;
  request: DocumentSyncRequest;
  storedDocument: DocumentCreateResponse;
}): Promise<DocumentSyncResponse> {
  const updates = await Promise.all(
    input.request.outgoingUpdates.map(async (update) => {
      const writeHeader = assertWriteHeader(
        update.writeHeader,
        "metadata sync write header",
      );
      return {
        accessEpoch: 1,
        id: update.id,
        documentId: input.storedDocument.id,
        authorFingerprint: writeHeader.writerKeyFingerprint,
        encryptedData: update.encryptedData,
        partialStartVersionVector: update.partialStartVersionVector,
        partialEndVersionVector: update.partialEndVersionVector,
        plaintextHash: update.plaintextHash,
        createdAt: "2026-04-27T00:00:00.000Z",
        writeHeader: update.writeHeader,
      };
    }),
  );

  return {
    acceptedOutgoingUpdateIds: input.request.outgoingUpdates.map(
      (update) => update.id,
    ),
    commitLsn: input.commitLsn,
    contentKeyBundle: input.storedDocument.contentKeyBundle,
    contentKeyBundles: [input.storedDocument.contentKeyBundle],
    documentId: input.storedDocument.id,
    documentKekTargets: input.storedDocument.documentKekTargets,
    pullPage: { hasMore: false, nextCursor: null },
    updates,
  };
}

export function readRequestString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = Reflect.get(record, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${key} to be a non-empty string.`);
  }

  return value;
}

export async function createExplorerContainerMutationResponse(
  request: ContainerMutationRequest,
  previousProjection?: ContainerWriterProjectionResponse | undefined,
): Promise<ContainerMutationResponse> {
  const previousKek = previousProjection?.containerKeks.at(-1);
  const response = await createContainerMutationResponseFromRequest(
    request,
    previousKek,
  );
  const previousManifest =
    request.previousManifest &&
    typeof request.previousManifest === "object" &&
    "manifestHash" in request.previousManifest
      ? request.previousManifest
      : null;
  const previousManifestResponse = previousManifest
    ? requireAccessManifestBundleWireResponse(previousManifest)
    : null;
  const historyByHash = new Map<string, AccessManifestBundleWireResponse>();
  for (const bundle of [
    ...(previousManifestResponse ? [previousManifestResponse] : []),
    ...(previousKek?.containerManifestHistory ?? []),
    ...(request.containerManifestHistory ?? []).map(
      requireAccessManifestBundleWireResponse,
    ),
  ]) {
    if (
      Reflect.get(bundle.state, "containerId") === response.containerId &&
      !historyByHash.has(bundle.manifestHash)
    ) {
      historyByHash.set(bundle.manifestHash, bundle);
    }
  }
  const containerManifestHistory = [...historyByHash.values()];
  return containerManifestHistory.length > 0
    ? {
        ...response,
        containerKek: {
          ...response.containerKek,
          containerManifestHistory,
        },
      }
    : response;
}

function requireAccessManifestBundleWireResponse(
  value: unknown,
): AccessManifestBundleWireResponse {
  if (!isAccessManifestBundleWireResponse(value)) {
    throw new Error("Expected previous manifest response bundle");
  }
  return value;
}

import {
  type createContainerContentsStore as createExplorerStore,
  defaultDocumentsPersistence,
  defaultContainerContentsPersistence as defaultExplorerPersistence,
} from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import {
  type ContainerKekRecipientTarget,
  computeAccessEventHash,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
} from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import type {
  ContainerMutationRequest,
  DocumentCreateRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  AccessManifestBundleWireResponse,
  ContainerMutationResponse,
  ContainerSummary,
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentSyncResponse,
  ListContainersResponse,
} from "@tearleads/validators/response";
import { isAccessManifestBundleWireResponse } from "@tearleads/validators/util";
import {
  assertAccessEvent,
  assertContainerKeyEpoch,
  assertWriteHeader,
} from "../keyingAssertions";

export type ExplorerRuntime = Parameters<typeof createExplorerStore>[0];
export type TestRuntime = ExplorerRuntime & { close: () => void };
export type ExplorerRuntimePatch = Partial<ExplorerRuntime> & {
  cacheReferencedPrincipalPolicies?: ExplorerRuntime["util"]["cacheReferencedPrincipalPolicies"];
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
    "createdAt" | "depth" | "effectiveAccessLevel" | "updatedAt"
  > &
    Partial<Pick<ContainerSummary, "createdAt" | "depth" | "updatedAt">>,
): ContainerSummary {
  return {
    createdAt: TEST_SYNC_TIMESTAMP,
    depth: overrides.parentId === null ? 0 : 1,
    effectiveAccessLevel: "admin",
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
    documentId: input.storedDocument.id,
    documentKekTargets: input.storedDocument.documentKekTargets,
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
): Promise<ContainerMutationResponse> {
  const body = request.body as Record<string, unknown>;
  const manifest = request.manifest as Record<string, unknown>;
  const keyEpoch = assertContainerKeyEpoch(
    request.keyEpoch,
    "container mutation key epoch",
  );
  const event = assertAccessEvent(request.event, "container mutation event");
  const eventHash = await computeAccessEventHash(event);
  const previousState = request.previousManifest?.state ?? null;
  const containerId = readRequestString(manifest, "objectId");
  const organizationId = readRequestString(manifest, "organizationId");
  const parentIdValue = Reflect.get(body, "parentContainerId");
  const parentId =
    typeof parentIdValue === "string"
      ? parentIdValue
      : previousState &&
          typeof Reflect.get(previousState, "parentContainerId") === "string"
        ? (Reflect.get(previousState, "parentContainerId") as string)
        : null;
  const metadataDocumentIdValue = Reflect.get(body, "metadataDocumentId");
  const metadataDocumentId =
    typeof metadataDocumentIdValue === "string"
      ? metadataDocumentIdValue
      : previousState &&
          typeof Reflect.get(previousState, "metadataDocumentId") === "string"
        ? (Reflect.get(previousState, "metadataDocumentId") as string)
        : `${containerId}-metadata-document`;
  const containerKeyEpochId = readRequestString(body, "containerKeyEpochId");
  const previousDirectGrants = previousState
    ? Reflect.get(previousState, "directGrants")
    : undefined;
  const directGrants = Array.isArray(previousDirectGrants)
    ? [...previousDirectGrants]
    : [];
  const eventType = Reflect.get(body, "eventType");
  if (eventType === "container.grant") {
    directGrants.push(Reflect.get(body, "grant"));
  }
  const recipientTargets: ContainerKekRecipientTarget[] = request.wraps.map(
    (wrap) => ({
      recipientKind: Reflect.get(wrap, "recipientKind"),
      recipientId: Reflect.get(wrap, "recipientId"),
      recipientKeyEpochId: Reflect.get(wrap, "recipientKeyEpochId"),
      recipientKeyFingerprint: Reflect.get(wrap, "recipientKeyFingerprint"),
    }),
  ) as ContainerKekRecipientTarget[];
  const previousManifest =
    request.previousManifest &&
    typeof request.previousManifest === "object" &&
    "manifestHash" in request.previousManifest
      ? request.previousManifest
      : null;
  const previousManifestResponse = previousManifest
    ? requireAccessManifestBundleWireResponse(previousManifest)
    : null;

  return {
    containerId,
    createdAt: "2026-05-05T00:00:00.000Z",
    organizationId,
    parentId,
    updatedAt: "2026-05-05T00:00:01.000Z",
    manifestHead: {
      epoch: Number(Reflect.get(manifest, "epoch")),
      manifestHash: request.expectedManifestHash,
    },
    accessManifest: {
      event: { event: { ...event }, body, eventHash },
      manifest,
      manifestHash: request.expectedManifestHash,
      state: {
        version: 1,
        containerId,
        organizationId,
        epoch: Number(Reflect.get(manifest, "epoch")),
        previousManifestHash: Reflect.get(manifest, "previousManifestHash"),
        eventHash,
        parentContainerId: parentId,
        parentManifestHash:
          Reflect.get(body, "parentManifestHash") ??
          (previousState
            ? Reflect.get(previousState, "parentManifestHash")
            : null),
        metadataDocumentId,
        containerKeyEpochId,
        directGrants,
        referencedPrincipalHeads: [],
      },
    },
    containerKek: {
      containerId,
      accessManifestHash: request.expectedManifestHash,
      containerKeyEpochId,
      containerKeyEpoch: keyEpoch.keyEpoch,
      keyEpoch: request.keyEpoch,
      keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
      keyTargetHash:
        await computeContainerKekRecipientTargetHash(recipientTargets),
      parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
      ...(previousManifestResponse
        ? { containerManifestHistory: [previousManifestResponse] }
        : {}),
      recipientTargets: recipientTargets as unknown as Record<
        string,
        unknown
      >[],
      wraps: request.wraps,
    },
    referencedPrincipalHeads: [],
  };
}

function requireAccessManifestBundleWireResponse(
  value: unknown,
): AccessManifestBundleWireResponse {
  if (!isAccessManifestBundleWireResponse(value)) {
    throw new Error("Expected previous manifest response bundle");
  }
  return value;
}

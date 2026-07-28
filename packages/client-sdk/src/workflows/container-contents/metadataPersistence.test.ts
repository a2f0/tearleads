import { expect, test } from "bun:test";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { createContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import type {
  ContainerContentsPersistence,
  ContainerMetadataRecord,
} from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { persistContainerMetadataStateFromRuntime } from "./metadataPersistence";
import type {
  ContainerMetadataPatch,
  ContainerMetadataState,
} from "./metadataTypes";

const execSql: ExecSql = async () => [];
const runtime = { infra: { execSql } };

function createMetadataWriterProjection(
  documentId: string,
): DocumentWriterProjectionResponse {
  const manifestHash = "document-manifest-hash";
  const targetHash = "document-target-hash";

  return {
    authorizingContainerPaths: [],
    contentKeyBundle: {
      contentKeyEpoch: 1,
      documentId,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets: [],
    },
    documentContainerManifestHistory: [],
    documentId,
    documentKekTargets: {
      documentId,
      documentKeyTargetHash: targetHash,
      linkedContainerKeyEpochIds: [],
      linkedContainerManifestHashes: [],
      linkSetManifestHash: manifestHash,
      targets: [],
    },
    documentManifest: {
      event: { body: {}, event: {}, eventHash: "document-event-hash" },
      manifest: {},
      manifestHash,
      state: {},
    },
    documentManifestContainerPaths: [],
    documentManifestHistory: [],
  };
}

function createPersistence(): ContainerContentsPersistence {
  return {
    async containerExists() {
      return false;
    },
    async deleteContainer() {},
    async deleteContainers() {},
    async deletePendingUpdates() {},
    async ensureSchema() {},
    async enqueuePendingUpdate() {},
    async listContainerIdsWithPendingUpdates() {
      return [];
    },
    async loadContainerMetadataRecord() {
      return null;
    },
    async listPendingCreateIntents() {
      return [];
    },
    async listPendingMoveIntents() {
      return [];
    },
    async rekeyPendingUpdate() {
      return null;
    },
    async listPendingUpdates() {
      return [];
    },
    async listUnsyncedMoveIntents() {
      return [];
    },
    async loadContainers() {
      return [];
    },
    async markCreateIntentSynced() {},
    async markMoveIntentSynced() {},
    async reassignContainerDocuments() {},
    async reconcileLocalRootContainer() {},
    async reconcileLocalSystemContainer() {},
    async recordCreateIntentError() {},
    async recordMoveIntentError() {},
    async saveContainer(_execSql, container) {
      return container;
    },
    async saveContainerAndDeletePendingUpdates(_execSql, container) {
      return container;
    },
  };
}

async function createMetadataState(): Promise<ContainerMetadataState> {
  const container: ContainerRecord = {
    effectiveAccessLevel: "admin",
    icon: null,
    id: "container-1",
    metadataDocumentId: "metadata-document-1",
    name: "Stored container",
    organizationId: "org-1",
    parentId: "parent-1",
  };
  const record: ContainerMetadataRecord = {
    accessEpoch: 1,
    accessStateHash: "access-state-hash",
    contentKeyBundle: "content-key-bundle",
    documentId: "metadata-document-1",
    documentKekTargets: "document-kek-targets",
    documentManifestBundle: "document-manifest-bundle",
    id: container.id,
    lastCommitLsn: "0/1",
    metadataUpdates: "",
    snapshotEndVersion: "",
  };

  return {
    container,
    doc: await createContainerMetadataDocument(container.id),
    metadataWriterProjection: createMetadataWriterProjection(
      "metadata-document-1",
    ),
    record,
  };
}

test.each([
  {
    label: "access epoch changes",
    patch: { accessEpoch: 2 },
  },
  {
    label: "metadata document identity changes",
    patch: { documentId: "metadata-document-2" },
  },
  {
    label: "metadata document identity is cleared",
    patch: { documentId: null },
  },
] satisfies Array<{
  label: string;
  patch: Partial<ContainerMetadataPatch>;
}>)("clears the cached metadata writer projection when $label", async ({
  patch,
}) => {
  const metadataState = await createMetadataState();

  const persisted = await persistContainerMetadataStateFromRuntime({
    metadataState,
    patch,
    persistence: createPersistence(),
    runtime,
  });

  expect(metadataState.metadataWriterProjection).toBeNull();
  expect(persisted.record).toMatchObject({
    contentKeyBundle: null,
    documentKekTargets: null,
    documentManifestBundle: null,
    ...patch,
  });
});

test("preserves the cached metadata writer projection for metadata-only changes", async () => {
  const metadataState = await createMetadataState();
  const writerProjection = metadataState.metadataWriterProjection;

  await persistContainerMetadataStateFromRuntime({
    metadataState,
    patch: { name: "Renamed container" },
    persistence: createPersistence(),
    runtime,
  });

  expect(metadataState.metadataWriterProjection).toBe(writerProjection);
});

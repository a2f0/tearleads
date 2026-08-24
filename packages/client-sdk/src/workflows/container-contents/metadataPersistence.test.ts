import { expect, test } from "bun:test";
import type { DocumentWriterProjectionResponse } from "@symcrypt/validators/response";
import { createContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import type { ContainerMetadataRecord } from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createContainerContentsPersistence } from "./metadata.testFixtures";
import {
  installContainerMetadataRecord,
  persistContainerMetadataStateFromRuntime,
} from "./metadataPersistence";
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
    pullContinuation: {
      commitLsn: "0/2",
      commitLsnMode: "tracked",
      cursor: "metadata-page-2",
    },
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

function createPersistenceForMetadataState(
  metadataState: ContainerMetadataState,
) {
  return createContainerContentsPersistence({
    storedContainers: [
      {
        container: metadataState.container,
        record: metadataState.record,
      },
    ],
  });
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
    persistence: createPersistenceForMetadataState(metadataState),
    runtime,
  });
  if (!persisted) throw new Error("Expected persisted metadata state");

  expect(metadataState.metadataWriterProjection).toBeNull();
  expect(persisted.record).toMatchObject({
    contentKeyBundle: null,
    documentKekTargets: null,
    documentManifestBundle: null,
    pullContinuation: null,
    ...patch,
  });
  installContainerMetadataRecord(metadataState, persisted.record);
  expect(metadataState.pullContinuation).toBeNull();
});

test("metadata-only changes preserve writer projection and pull progress", async () => {
  const metadataState = await createMetadataState();
  const writerProjection = metadataState.metadataWriterProjection;

  const persisted = await persistContainerMetadataStateFromRuntime({
    metadataState,
    patch: { name: "Renamed container" },
    persistence: createPersistenceForMetadataState(metadataState),
    runtime,
  });
  if (!persisted) throw new Error("Expected persisted metadata state");

  expect(metadataState.metadataWriterProjection).toBe(writerProjection);
  expect(persisted.record.pullContinuation).toEqual({
    commitLsn: "0/2",
    commitLsnMode: "tracked",
    cursor: "metadata-page-2",
  });
  installContainerMetadataRecord(metadataState, persisted.record);
  expect(metadataState.pullContinuation).toEqual(
    persisted.record.pullContinuation,
  );
});

test("an explicit cursor invalidation clears with a metadata save", async () => {
  const metadataState = await createMetadataState();

  const persisted = await persistContainerMetadataStateFromRuntime({
    metadataState,
    patch: {
      name: "Renamed after invalidation",
      pullContinuation: null,
    },
    persistence: createPersistenceForMetadataState(metadataState),
    runtime,
  });
  if (!persisted) throw new Error("Expected persisted metadata state");

  expect(persisted.record.pullContinuation).toBeNull();
});

test("metadata mutation conflict exhaustion fails instead of dropping the edit", async () => {
  const metadataState = await createMetadataState();
  const storedState = {
    container: metadataState.container,
    record: metadataState.record,
  };
  const basePersistence = createPersistenceForMetadataState(metadataState);
  let conflictCount = 0;
  const persistence = {
    ...basePersistence,
    commitMetadataMutation: async () => {
      conflictCount += 1;
      return { committed: false as const, currentState: storedState };
    },
  };

  await expect(
    persistContainerMetadataStateFromRuntime({
      metadataState,
      patch: { name: "Unsaved local rename" },
      persistence,
      runtime,
    }),
  ).rejects.toThrow(
    "Container metadata mutation commit gave up after 8 concurrent conflicts",
  );
  expect(conflictCount).toBe(8);
});

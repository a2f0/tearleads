import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { createDocument, exportAllUpdates } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  createContainerContentsPersistence,
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import {
  persistContainerMetadataStateFromRuntime,
  renameContainerMetadataStateFromRuntime,
} from "./metadataPersistence";

test("a structural metadata save reloads a replacement identity", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-structural-save-identity-race",
  );
  const staleContainer = createContainerRecord({
    id: "container-1",
    metadataDocumentId: "metadata-document-old",
    parentId: "parent-old",
  });
  const durableContainer = {
    ...staleContainer,
    metadataDocumentId: "metadata-document-new",
    parentId: "parent-new",
  };
  const staleRecord = createDocumentRecord({
    documentId: "metadata-document-old",
    id: staleContainer.id,
  });
  try {
    const staleDoc = await createDocument("metadata-structural-stale");
    writeContainerMetadataValue(staleDoc, {
      icon: null,
      name: "Stale metadata",
    });
    const durableDoc = await createDocument("metadata-structural-durable");
    writeContainerMetadataValue(durableDoc, {
      icon: "cloud",
      name: "Replacement metadata",
    });
    const durableRecord = createDocumentRecord({
      accessEpoch: 2,
      accessStateHash: "access-new",
      documentId: "metadata-document-new",
      id: staleContainer.id,
      metadataUpdates: bytesToBase64(exportAllUpdates(durableDoc)),
    });
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      durableContainer,
      durableRecord,
    );
    const metadataState = {
      container: staleContainer,
      doc: staleDoc,
      record: staleRecord,
    };

    const saved = await persistContainerMetadataStateFromRuntime({
      metadataState,
      patch: { parentId: "stale-structural-parent" },
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql } },
    });

    expect(saved).toMatchObject({
      container: durableContainer,
      pullContinuationSuperseded: true,
      record: {
        accessEpoch: 2,
        accessStateHash: "access-new",
        documentId: "metadata-document-new",
        metadataUpdates: durableRecord.metadataUpdates,
      },
      syncIdentitySuperseded: true,
    });
    expect(readContainerMetadataValue(metadataState.doc, "/")).toEqual({
      icon: "cloud",
      name: "Replacement metadata",
    });
    expect(
      (await sqlContainerContentsPersistence.loadContainers(execSql))[0],
    ).toMatchObject({
      container: durableContainer,
      record: {
        accessEpoch: 2,
        accessStateHash: "access-new",
        documentId: "metadata-document-new",
        metadataUpdates: durableRecord.metadataUpdates,
      },
    });
  } finally {
    close();
  }
});

test("a structural metadata save cannot resurrect a deleted container", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-structural-save-deletion-race",
  );
  const container = createContainerRecord({
    id: "container-1",
    metadataDocumentId: "metadata-document-1",
    parentId: "parent-old",
  });
  const record = createDocumentRecord({
    documentId: "metadata-document-1",
    id: container.id,
  });
  try {
    const doc = await createDocument("metadata-structural-deleted");
    writeContainerMetadataValue(doc, { icon: null, name: "Deleted" });
    record.metadataUpdates = bytesToBase64(exportAllUpdates(doc));
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container,
      record,
    );
    await sqlContainerContentsPersistence.deleteContainer(
      execSql,
      container.id,
    );

    const saved = await persistContainerMetadataStateFromRuntime({
      metadataState: { container, doc, record },
      patch: { parentId: "must-not-resurrect" },
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql } },
    });

    expect(saved).toBeNull();
    expect(
      await sqlContainerContentsPersistence.loadContainers(execSql),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("a metadata rename cannot cross a newer read-only container state", async () => {
  const { close, execSql } = await createTestExecSql(
    "metadata-rename-structural-race",
  );
  const staleContainer = createContainerRecord({
    effectiveAccessLevel: "admin",
    id: "container-1",
    metadataDocumentId: "metadata-document-1",
    name: "Old name",
    organizationId: "organization-old",
    parentId: "parent-old",
  });
  const durableContainer = {
    ...staleContainer,
    effectiveAccessLevel: "read" as const,
    organizationId: "organization-new",
    parentId: "parent-new",
  };
  const record = createDocumentRecord({
    documentId: "metadata-document-1",
    id: staleContainer.id,
  });
  try {
    const doc = await createDocument("metadata-rename-structural-race");
    writeContainerMetadataValue(doc, { icon: "folder", name: "Old name" });
    record.metadataUpdates = bytesToBase64(exportAllUpdates(doc));
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      durableContainer,
      record,
    );

    const saved = await renameContainerMetadataStateFromRuntime({
      metadataState: { container: staleContainer, doc, record },
      name: "New name",
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql } },
    });

    expect(saved?.container).toMatchObject({
      effectiveAccessLevel: "read",
      metadataDocumentId: "metadata-document-1",
      name: "Old name",
      organizationId: "organization-new",
      parentId: "parent-new",
    });
    expect(
      (await sqlContainerContentsPersistence.loadContainers(execSql))[0]
        ?.container,
    ).toMatchObject({
      effectiveAccessLevel: "read",
      metadataDocumentId: "metadata-document-1",
      name: "Old name",
      organizationId: "organization-new",
      parentId: "parent-new",
    });
  } finally {
    close();
  }
});

test("a metadata save loads only its authoritative container", async () => {
  const container = createContainerRecord({
    id: "target-container",
    metadataDocumentId: "target-metadata",
    parentId: "parent",
  });
  const record = createDocumentRecord({
    documentId: "target-metadata",
    id: container.id,
  });
  const doc = await createDocument("metadata-targeted-lookup");
  writeContainerMetadataValue(doc, { icon: null, name: "Before" });
  record.metadataUpdates = bytesToBase64(exportAllUpdates(doc));
  const savedContainers: Parameters<
    typeof createContainerContentsPersistence
  >[0]["savedContainers"] = [];
  const persistence = {
    ...createContainerContentsPersistence({
      savedContainers,
      storedContainers: [{ container, record }],
    }),
    loadContainers: async () => {
      throw new Error("metadata save must not scan every container");
    },
  };

  const saved = await renameContainerMetadataStateFromRuntime({
    metadataState: { container, doc, record },
    name: "After",
    persistence,
    runtime: { infra: { execSql: async () => [] } },
  });

  expect(saved?.container.name).toBe("After");
  expect(savedContainers).toHaveLength(1);
});

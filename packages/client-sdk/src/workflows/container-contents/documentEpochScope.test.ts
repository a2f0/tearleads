import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence as metadata } from "../../data/persistence/container-contents/containerContentsPersistence";
import { DocumentContainerProjectionRepository as Links } from "../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { ContainerDocumentTombstoneHoldRepository } from "../../data/persistence/documents/containerDocumentTombstoneHoldRepository";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { testContainerMetadataWriter } from "./metadata/metadata.testFixtures";
import { hydrateStoredContainerState } from "./storedContainerState";

const holds = (execSql: ExecSql) =>
  new ContainerDocumentTombstoneHoldRepository(execSql);

const at = "2026-09-28T00:00:00.000Z";
const container = {
  effectiveAccessLevel: "write" as const,
  icon: null,
  id: "decoy-container",
  metadataDocumentId: "document-1",
  name: "Decoy",
  organizationId: "organization-1",
  parentId: null,
};
const record = {
  id: container.id,
  accessEpoch: Number.MAX_SAFE_INTEGER,
  documentId: "document-1",
  metadataUpdates: "",
  snapshotEndVersion: "",
};

test.each(["metadata-first", "document-first"] as const)(
  "%s metadata cannot raise a document epoch floor or block placement",
  async (order) => {
    const { execSql, close } = await createTestExecSql("metadata-epoch-scope");
    try {
      await metadata.ensureSchema(execSql);
      if (order === "metadata-first") {
        await metadata.saveContainer(execSql, container, record);
        expect(
          await holds(execSql).loadLocalDocumentAccessEpoch("document-1"),
        ).toBe(0);
      }
      await execSql(
        "INSERT INTO documents (app_kind, local_id, document_id, access_epoch, updated_at) VALUES (?, ?, ?, ?, ?)",
        ["documents", "local-document", "document-1", 2, at],
      );
      if (order === "document-first") {
        await metadata.saveContainer(execSql, container, record);
      }
      expect(
        await holds(execSql).loadLocalDocumentAccessEpoch("document-1"),
      ).toBe(2);
      await new Links(execSql).replaceDocumentLinksBatch([
        {
          documentId: "document-1",
          containerIds: ["honest-container"],
          accessEpoch: 3,
        },
      ]);
      expect(
        await new Links(execSql).listLinkedContainerIds("document-1"),
      ).toEqual(["honest-container"]);
      await new Links(execSql).replaceDocumentLinksBatch([
        {
          documentId: "document-1",
          containerIds: ["stale-container"],
          accessEpoch: 1,
        },
      ]);
      expect(
        await new Links(execSql).listLinkedContainerIds("document-1"),
      ).toEqual(["honest-container"]);
      expect(
        (await metadata.loadContainerMetadataRecord(execSql, container.id))
          ?.accessEpoch,
      ).toBe(Number.MAX_SAFE_INTEGER);
    } finally {
      await close();
    }
  },
);

test("metadata saved before an ordinary document remains readable at startup", async () => {
  const { execSql, close } = await createTestExecSql(
    "metadata-collision-startup",
  );
  try {
    await metadata.ensureSchema(execSql);
    await metadata.saveContainer(execSql, container, record);
    await execSql(
      "INSERT INTO documents (app_kind, local_id, document_id, access_epoch, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["documents", "local-document", "document-1", 2, at],
    );
    const storedContainer = await metadata.loadContainerMetadataState(
      execSql,
      container.id,
    );
    if (!storedContainer) throw new Error("Missing stored metadata fixture");
    const restored = await hydrateStoredContainerState({
      execSql,
      persistence: metadata,
      storedContainer,
      writer: testContainerMetadataWriter,
    });
    expect(restored.container.id).toBe(container.id);
    expect(
      await holds(execSql).loadLocalDocumentAccessEpoch("document-1"),
    ).toBe(2);
  } finally {
    await close();
  }
});

test("a legacy child repair cannot bypass a custom persistence adapter", async () => {
  const { close, execSql } = await createTestExecSql("legacy-repair-adapter");
  try {
    await metadata.ensureSchema(execSql);
    const legacy = {
      ...container,
      parentId: "parent",
      metadataDocumentId: null,
    };
    const persistence = {
      ...metadata,
      saveContainer: async () => {
        throw new Error("custom backend");
      },
    };
    await expect(
      hydrateStoredContainerState({
        execSql,
        persistence,
        storedContainer: { container: legacy, record: null },
        writer: testContainerMetadataWriter,
      }),
    ).rejects.toThrow("saveContainerWithPendingUpdate");
    const saved: string[] = [];
    const custom = {
      ...persistence,
      saved,
      async saveContainerWithPendingUpdate(
        _sql: ExecSql,
        row: Parameters<typeof metadata.saveContainer>[1],
      ) {
        this.saved.push(row.id);
        return row;
      },
    };
    await hydrateStoredContainerState({
      execSql,
      persistence: custom,
      storedContainer: { container: legacy, record: null },
      writer: testContainerMetadataWriter,
    });
    expect(saved).toEqual([legacy.id]);
    expect(await metadata.containerExists(execSql, legacy.id)).toBe(false);
  } finally {
    await close();
  }
});

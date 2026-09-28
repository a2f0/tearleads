import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence as metadata } from "../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentContainerProjectionPersistence as links } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { loadLocalDocumentAccessEpoch } from "../../data/persistence/documents/containerDocumentTombstoneHoldsPersistence";

import { hydrateStoredContainerState } from "./storedContainerState";

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
        expect(await loadLocalDocumentAccessEpoch(execSql, "document-1")).toBe(
          0,
        );
      }
      await execSql(
        "INSERT INTO documents (app_kind, local_id, document_id, access_epoch, updated_at) VALUES (?, ?, ?, ?, ?)",
        ["documents", "local-document", "document-1", 2, at],
      );
      if (order === "document-first") {
        await metadata.saveContainer(execSql, container, record);
      }
      expect(await loadLocalDocumentAccessEpoch(execSql, "document-1")).toBe(2);
      await links.replaceDocumentLinksBatch(execSql, [
        {
          documentId: "document-1",
          containerIds: ["honest-container"],
          accessEpoch: 3,
        },
      ]);
      expect(await links.listLinkedContainerIds(execSql, "document-1")).toEqual(
        ["honest-container"],
      );
      await links.replaceDocumentLinksBatch(execSql, [
        {
          documentId: "document-1",
          containerIds: ["stale-container"],
          accessEpoch: 1,
        },
      ]);
      expect(await links.listLinkedContainerIds(execSql, "document-1")).toEqual(
        ["honest-container"],
      );
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
    });
    expect(restored.container.id).toBe(container.id);
    expect(await loadLocalDocumentAccessEpoch(execSql, "document-1")).toBe(2);
  } finally {
    await close();
  }
});

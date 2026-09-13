import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { deriveStableDocumentId } from "../../documents/shared/stableDocumentId";
import { sqlDocumentsPersistence } from "./documentsPersistence";

test("discovery cannot adopt or redirect an unacknowledged create", async () => {
  const database = await createTestExecSql("pending-create-discovery-scope");
  const pending = {
    id: "pending-private-note",
    containerId: "private-container",
    documentId: null,
    text: "queued private edits",
    snapshotEndVersion: "",
    accessEpoch: 1,
  };
  try {
    await sqlDocumentsPersistence.ensureSchema(database.execSql);
    await sqlDocumentsPersistence.saveDocument(database.execSql, pending);
    const documentId = await deriveStableDocumentId(pending.id);
    await sqlDocumentsPersistence.upsertDiscoveredDocument(database.execSql, {
      accessEpoch: 8,
      containerId: "shared-container",
      createdAt: new Date().toISOString(),
      documentId,
      linkedContainerIds: ["shared-container"],
    });
    await expect(
      sqlDocumentsPersistence.loadDocument(database.execSql, pending.id),
    ).resolves.toMatchObject(pending);
    await expect(
      sqlDocumentsPersistence.loadDocument(database.execSql, documentId),
    ).resolves.toBeNull();
  } finally {
    database.close();
  }
});

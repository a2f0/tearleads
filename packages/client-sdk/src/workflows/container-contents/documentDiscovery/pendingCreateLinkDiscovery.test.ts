import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { deriveStableDocumentId } from "../../../data/documents/shared/stableDocumentId";
import { DocumentContainerProjectionRepository as Links } from "../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import {
  sqlDocumentsPersistence as documents,
  upsertDiscoveredDocuments,
} from "../../../data/persistence/documents/documentsPersistence";
import {
  discoverContainerDocuments,
  laneLister,
  nullContainerDocumentWatermarks,
} from "./documentDiscovery.testUtils";
import type { DiscoverContainerDocumentsOptions } from "./documentDiscoveryTypes";

test("discovery preserves pending-create links while discovering unrelated documents", async () => {
  const { execSql, close } = await createTestExecSql(
    "pending-create-link-discovery",
  );
  try {
    await documents.ensureSchema(execSql);
    const localId = "pending-private-note";
    const documentId = await deriveStableDocumentId(localId);
    await documents.saveDocument(execSql, {
      id: localId,
      accessEpoch: 1,
      containerId: "private-container",
      documentId: null,
      text: "private edits",
      snapshotEndVersion: "",
    });
    await new Links(execSql).replaceDocumentLinks(documentId, [
      "private-container",
    ]);
    const options: DiscoverContainerDocumentsOptions = {
      ...nullContainerDocumentWatermarks,
      containerId: "shared-container",
      listContainerDocumentLanes: laneLister(async () => ({
        hasMore: false,
        nextWatermark: null,
        tombstones: [],
        items: [documentId, "unrelated-document"].map((id) => ({
          id,
          createdAt: "2026-09-12T00:00:00.000Z",
          updatedAt: "2026-09-12T00:00:00.000Z",
          currentAccessEpoch: 1,
          currentAccessStateHash: "1".repeat(64),
          linkedContainerIds: ["shared-container"],
          referencedPrincipals: [],
        })),
      })),
      replaceDocumentLinksBatch: (inputs) =>
        new Links(execSql).replaceDocumentLinksBatch(inputs),
      upsertDiscoveredDocuments: (inputs) =>
        upsertDiscoveredDocuments(execSql, inputs),
    };
    await discoverContainerDocuments(options);
    expect(await new Links(execSql).listLinkedContainerIds(documentId)).toEqual(
      ["private-container"],
    );
    expect(
      await new Links(execSql).listLinkedContainerIds("unrelated-document"),
    ).toEqual(["shared-container"]);
    expect(await documents.loadDocument(execSql, localId)).toMatchObject({
      containerId: "private-container",
      documentId: null,
      text: "private edits",
    });
  } finally {
    close();
  }
});

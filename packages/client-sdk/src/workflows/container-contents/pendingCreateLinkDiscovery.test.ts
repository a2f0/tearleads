import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { deriveStableDocumentId } from "../../data/documents/shared/stableDocumentId";
import { sqlDocumentContainerProjectionPersistence as links } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import {
  sqlDocumentsPersistence as documents,
  upsertDiscoveredDocuments,
} from "../../data/persistence/documents/documentsPersistence";
import {
  discoverAllContainerDocuments,
  discoverContainerDocuments,
} from "./documentDiscovery";
import { nullContainerDocumentWatermarks } from "./documentDiscovery.testUtils";
import type { DiscoverContainerDocumentsOptions } from "./documentDiscoveryTypes";

for (const mode of ["single", "all"]) {
  test(`${mode} discovery preserves pending-create links while discovering unrelated documents`, async () => {
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
      await links.replaceDocumentLinks(execSql, documentId, [
        "private-container",
      ]);
      const options: DiscoverContainerDocumentsOptions = {
        ...nullContainerDocumentWatermarks,
        containerId: "shared-container",
        listContainerDocuments: async () => ({
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
        }),
        replaceDocumentLinksBatch: (inputs) =>
          links.replaceDocumentLinksBatch(execSql, inputs),
        upsertDiscoveredDocuments: (inputs) =>
          upsertDiscoveredDocuments(execSql, inputs),
      };
      if (mode === "single") await discoverContainerDocuments(options);
      else
        await discoverAllContainerDocuments({
          ...options,
          containerIds: ["shared-container"],
        });
      expect(await links.listLinkedContainerIds(execSql, documentId)).toEqual([
        "private-container",
      ]);
      expect(
        await links.listLinkedContainerIds(execSql, "unrelated-document"),
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
}

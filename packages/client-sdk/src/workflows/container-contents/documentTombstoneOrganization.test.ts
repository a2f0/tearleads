import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentContainerProjectionPersistence as links } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import {
  applyContainerDocumentTombstones,
  sqlDocumentsPersistence as documents,
} from "../../data/persistence/documents/documentsPersistence";
import { createContainerDocumentTombstoneVerifier } from "./documentTombstoneEvidence";

for (const foreignLinks of [[], ["container"]]) {
  test(`a retained old-organization head cannot settle a replacement tombstone (${foreignLinks.length} links)`, async () => {
    const { execSql, close } = createNativeTestExecSql();
    try {
      await documents.ensureSchema(execSql);
      await documents.upsertDiscoveredDocument(execSql, {
        documentId: "document",
        containerId: "container",
        accessEpoch: 1,
        accessStateHash: "new-head",
        linkedContainerIds: ["container"],
        createdAt: "2026-09-28",
      });
      await links.replaceDocumentLinks(execSql, "document", ["container"]);
      const head = {
        // The post-signature boundary accepts the retained old pin at epoch 9.
        organizationId: "old",
        accessEpoch: 9,
        accessStateHash: "old-head",
        linkedContainerIds: foreignLinks,
      };
      const verify = createContainerDocumentTombstoneVerifier(
        "replacement",
        async () => head,
        async () => 1,
      );
      const verdicts = await verify([
        {
          documentId: "document",
          containerId: "container",
          updatedAt: "2026-09-28",
        },
      ]);
      for (const verdict of verdicts) {
        if (verdict.kind === "verified")
          await applyContainerDocumentTombstones(execSql, [verdict.tombstone]);
      }
      expect(
        await execSql(
          "SELECT container_id FROM document_container_projection WHERE document_id = 'document'",
        ),
      ).toEqual([{ container_id: "container" }]);
      expect(verdicts[0]?.kind).toBe("unverified");
    } finally {
      close();
    }
  });
}

test("a globally terminal document purge still settles a replacement tombstone", async () => {
  const verify = createContainerDocumentTombstoneVerifier(
    "replacement",
    async () => ({
      organizationId: null,
      accessEpoch: Number.MAX_SAFE_INTEGER,
      linkedContainerIds: [],
    }),
    async () => 1,
  );
  expect(
    (
      await verify([
        {
          documentId: "document",
          containerId: "container",
          updatedAt: "2026-09-28",
        },
      ])
    )[0]?.kind,
  ).toBe("verified");
});

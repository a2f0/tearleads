import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { adoptExistingRemoteDocument } from "./createAdoption";

test("create adoption does not prime or succeed after content-key unwrap expires", async () => {
  const fixture = await createMaterializedSyncFixture({
    documentId: "generation-expired-adoption",
  });
  const database = await createTestExecSql("generation-expired-adoption");
  const originalBundle = fixture.writerProjection.contentKeyBundle;
  const contentKeyBundle = { ...originalBundle };
  let current = true;
  let targetReads = 0;
  let primeCalls = 0;
  Object.defineProperty(contentKeyBundle, "targets", {
    enumerable: true,
    get: () => {
      targetReads += 1;
      if (targetReads === 2) current = false;
      return originalBundle.targets;
    },
  });
  const writerProjection: DocumentWriterProjectionResponse = {
    ...fixture.writerProjection,
    contentKeyBundle,
  };

  try {
    const adopted = await adoptExistingRemoteDocument({
      apiClient: {
        createDocument: async () => null,
        getContainerWriterProjection: async () => null,
        getDocumentWriterProjection: async () => writerProjection,
        primeDocumentWriterProjection: () => {
          primeCalls += 1;
        },
      },
      documentId: writerProjection.documentId,
      execSql: database.execSql,
      expectedContainerId: fixture.projection.containerId,
      expectedOrganizationId: fixture.author.organizationId,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      stillCurrent: () => current,
      targetSecretKey: fixture.secretKey,
    });

    expect(targetReads).toBeGreaterThanOrEqual(2);
    expect(adopted).toBeNull();
    expect(primeCalls).toBe(0);
  } finally {
    database.close();
  }
});

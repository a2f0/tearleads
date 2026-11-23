import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { adoptExistingRemoteDocument } from "./createAdoption";

test.each(SCOPE_RETIREMENTS)(
  "a document adoption read that expires after %s is not renewed or replayed",
  async (change) => {
    const documentId = crypto.randomUUID();
    const { close, execSql } = await createTestExecSql(
      `document-adoption-scope-${change}`,
    );
    const server = createExpiringApiServer({
      method: "GET",
      path: new RegExp(`^/documents/${documentId}/writer-projection$`),
    });
    let current = true;
    try {
      const adopted = adoptExistingRemoteDocument({
        apiClient: createMockApiClient({
          getDocumentWriterProjection: server.api.getDocumentWriterProjection,
        }),
        documentId,
        execSql,
        expectedContainerId: "adoption-container",
        expectedOrganizationId: "adoption-organization",
        expectedSignerUserId: "adoption-signer",
        resolveProjectionUserKey: async () => null,
        stillCurrent: () => current,
        targetSecretKey: generateKemSeedAndKeyPair().secretKey,
      });
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await adopted).toBeNull();
      expect(server.requests).toEqual([
        `GET /documents/${documentId}/writer-projection`,
      ]);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
      close();
    }
  },
  15_000,
);

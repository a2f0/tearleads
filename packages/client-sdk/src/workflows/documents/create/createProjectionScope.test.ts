import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createAuthor } from "../../../../test/helpers/data/documentFixturePrimitives";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { createRemoteDocumentForTest as createRemoteDocument } from "../../../../test/helpers/workflows/remoteDocumentServiceFixture";

test.each(SCOPE_RETIREMENTS)(
  "a document create's projection read that expires after %s does not renew",
  async (change) => {
    const { author } = await createAuthor();
    const keyPair = generateKemSeedAndKeyPair();
    const { close, execSql } = await createTestExecSql(
      `document-create-projection-scope-${change}`,
    );
    const server = createExpiringApiServer({
      method: "GET",
      path: /^\/containers\/[^/]+\/writer-projection$/,
    });
    const recordedFailures: unknown[] = [];
    let submissions = 0;
    let current = true;
    try {
      const created = createRemoteDocument({
        apiClient: createMockApiClient({
          createDocument: async () => {
            submissions += 1;
            return null;
          },
          getContainerWriterProjection: server.api.getContainerWriterProjection,
          getContainerWriterProjectionResult:
            server.api.getContainerWriterProjectionResult,
        }),
        author,
        containerId: "scoped-create-container",
        execSql,
        onTerminalSubmitFailure: (failure) => {
          recordedFailures.push(failure);
        },
        resolveProjectionUserKey: async () => null,
        stillCurrent: () => current,
        targetSecretKey: keyPair.secretKey,
      });
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await created).toBeNull();
      expect(server.requests).toEqual([
        "GET /containers/scoped-create-container/writer-projection",
      ]);
      expect(server.renewals.count).toBe(0);
      expect(recordedFailures).toEqual([]);
      expect(submissions).toBe(0);
    } finally {
      server.stop();
      close();
    }
  },
);

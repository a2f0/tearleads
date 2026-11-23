import { expect, test } from "bun:test";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { resolveSyncAttemptWriterProjection } from "./index";

test.each(SCOPE_RETIREMENTS)(
  "a sync attempt's projection read that expires after %s is not renewed or replayed",
  async (change) => {
    const documentId = crypto.randomUUID();
    const server = createExpiringApiServer({
      method: "GET",
      path: new RegExp(`^/documents/${documentId}/writer-projection$`),
    });
    let current = true;
    const outcomes: string[] = [];
    try {
      const resolved = resolveSyncAttemptWriterProjection({
        apiClient: server.api,
        documentId,
        onSyncAbandoned: (reason) => {
          outcomes.push(`abandoned: ${reason}`);
        },
        onTerminalFailure: async () => {
          outcomes.push("terminal failure");
        },
        reusableWriterProjection: null,
        stillCurrent: () => current,
      });
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await resolved).toBeNull();
      expect(outcomes).toEqual([]);
      expect(server.requests).toEqual([
        `GET /documents/${documentId}/writer-projection`,
      ]);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
    }
  },
  15_000,
);

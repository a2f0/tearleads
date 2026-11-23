import { expect, test } from "bun:test";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { moveRemoteContainerDocument } from "./documentLinksMove";
import type { ContainerDocumentLinkRuntime } from "./index";

test.each(SCOPE_RETIREMENTS)(
  "a move's document read that expires after %s is not renewed or replayed",
  async (change) => {
    const documentId = crypto.randomUUID();
    const server = createExpiringApiServer({
      method: "GET",
      path: new RegExp(`^/documents/${documentId}/writer-projection$`),
    });
    let current = true;
    const failures: unknown[] = [];
    try {
      const moved = moveRemoteContainerDocument({
        currentContainerId: crypto.randomUUID(),
        documentId,
        isCurrent: () => current,
        noteId: "move-scope-note",
        onFailure: (failure) => {
          failures.push(failure);
        },
        resolveProjectionUserKey: async () => null,
        rotationSnapshot: new Uint8Array(),
        runtime: {
          apiClient: server.api,
        } as unknown as ContainerDocumentLinkRuntime,
        targetContainerId: crypto.randomUUID(),
      });
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await moved).toBeNull();
      expect(failures).toEqual([]);
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

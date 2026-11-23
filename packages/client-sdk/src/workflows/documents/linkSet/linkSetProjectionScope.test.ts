import { expect, test } from "bun:test";
import {
  createMockApiClient,
  createMockRequestFailure,
} from "@tearleads/test-utils";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { createRemoteDocumentServiceFixture } from "../../../../test/helpers/workflows/remoteDocumentServiceFixture";
import type {
  DocumentLinkSetMutationApi,
  DocumentLinkSetMutationFailure,
} from "../../../data/documents/shared/types";

const HELD_READS = ["document", "container"] as const;

for (const held of HELD_READS) {
  test.each(SCOPE_RETIREMENTS)(
    `a relink's ${held} projection read that expires after %s is not renewed or replayed`,
    async (change) => {
      const documentId = crypto.randomUUID();
      const containerId = crypto.randomUUID();
      const path =
        held === "document"
          ? `/documents/${documentId}/writer-projection`
          : `/containers/${containerId}/writer-projection`;
      const server = createExpiringApiServer({
        method: "GET",
        path: new RegExp(`^${path}$`),
      });
      // The other read fails at once; only the held read decides the outcome.
      const unavailable = async () =>
        createMockRequestFailure({
          message: "Writer projection request failed (503)",
          method: "GET",
          status: 503,
        });
      const failures: DocumentLinkSetMutationFailure[] = [];
      let current = true;
      try {
        const apiClient = createMockApiClient({
          getContainerWriterProjectionResult:
            held === "container"
              ? server.api.getContainerWriterProjectionResult
              : unavailable,
          getDocumentWriterProjectionResult:
            held === "document"
              ? server.api.getDocumentWriterProjectionResult
              : unavailable,
          linkDocument: async () => {
            throw new Error("A retired relink must not submit");
          },
          primeDocumentWriterProjection: () => {},
        }) satisfies DocumentLinkSetMutationApi;
        const relinked = createRemoteDocumentServiceFixture({
          api: apiClient,
          encapsulationSecretKey: new Uint8Array(),
          execSql: (async () => []) as never,
        }).relinkRemoteDocument({
          author: null as never,
          contentKey: new Uint8Array(),
          documentId,
          onFailure: (failure) => {
            failures.push(failure);
          },
          operation: "link",
          resolveProjectionUserKey: async () => null,
          stillCurrent: () => current,
          targetContainerId: containerId,
        });
        await server.entered;
        current = false;
        server.retire(change);
        server.release();
        expect(await relinked).toBeNull();
        // A retired relink reports neither read's failure.
        expect(failures).toEqual([]);
        expect(server.requests).toEqual([`GET ${path}`]);
        expect(server.renewals.count).toBe(0);
      } finally {
        server.stop();
      }
    },
    15_000,
  );
}

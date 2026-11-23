import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  type ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import {
  DOCUMENT_MOVE_INTENT_TYPE,
  type DocumentMoveIntentRecord,
} from "../../../data/persistence/container-contents/documentMoveIntentPersistence";
import type { ContainerContentsWorkflowRuntime } from "../runtime";
import { moveWithVanishedContainerRefresh } from "./documentMoveVanishedRefresh";

const HELD_READS = ["destination probe", "source listing"] as const;

for (const held of HELD_READS) {
  test.each(SCOPE_RETIREMENTS)(
    `a vanished move's ${held} that expires after %s is not renewed or replayed`,
    async (change) => {
      const intent: DocumentMoveIntentRecord = {
        createdAt: "2026-11-22T00:00:00.000Z",
        documentId: crypto.randomUUID(),
        id: "vanished-scope-intent",
        intentType: DOCUMENT_MOVE_INTENT_TYPE,
        lastAttemptedAt: null,
        lastError: null,
        localId: "vanished-scope-note",
        replaceLinkedContainers: false,
        sourceContainerId: crypto.randomUUID(),
        syncStatus: "pending",
        targetContainerId: crypto.randomUUID(),
        updatedAt: "2026-11-22T00:00:00.000Z",
      };
      const path =
        held === "destination probe"
          ? `/containers/${intent.targetContainerId}/writer-projection`
          : `/documents/${intent.documentId}/writer-projection`;
      const server = createExpiringApiServer({
        method: "GET",
        path: new RegExp(`^${path}$`),
      });
      const { close, execSql } = await createTestExecSql(
        `vanished-move-scope-${held}-${change}`,
      );
      let current = true;
      let attempts = 0;
      try {
        const apiClient = {
          evictContainerWriterProjection: () => {},
          evictDocumentWriterProjection: () => {},
          getContainerWriterProjectionResult:
            held === "destination probe"
              ? server.api.getContainerWriterProjectionResult
              : async () => ({
                  data: {} as ContainerWriterProjectionResponse,
                  ok: true as const,
                }),
          getDocumentWriterProjectionResult:
            held === "source listing"
              ? server.api.getDocumentWriterProjectionResult
              : async () => {
                  throw new Error("A retired probe must not list sources");
                },
        } as unknown as ContainerContentsWorkflowRuntime["apiClient"];
        const refreshed = moveWithVanishedContainerRefresh({
          apiClient,
          attempt: async (onFailure) => {
            attempts += 1;
            onFailure({
              code: CONTAINER_NOT_FOUND_ERROR_CODE,
              message: "Container not found",
              status: 404,
            });
            return "partial";
          },
          execSql,
          existingContainerId: intent.sourceContainerId,
          intent,
          isCurrent: () => current,
        });
        await server.entered;
        current = false;
        server.retire(change);
        server.release();
        expect(await refreshed).toBe("abandoned");
        expect(attempts).toBe(1);
        expect(server.requests).toEqual([`GET ${path}`]);
        expect(server.renewals.count).toBe(0);
      } finally {
        server.stop();
        close();
      }
    },
    15_000,
  );
}

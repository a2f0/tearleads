import { expect, test } from "bun:test";
import {
  createMockApiClient,
  createMockRequestFailure,
} from "@tearleads/test-utils";
import type { DocumentLinkSetMutationApi } from "../../data/documents/shared/types";
import { relinkRemoteDocument } from "./linkSetRemote";

// When both projection fetches fail, the reported failure must carry the
// 403: any permission denial parks the move (row 7), so a non-403 document
// failure must not mask a container denial.
test("a dual projection failure reports the container 403", async () => {
  const failures: Array<{ message: string; status: number | null }> = [];
  const apiClient = createMockApiClient({
    getContainerWriterProjection: async () => null,
    getContainerWriterProjectionResult: async () =>
      createMockRequestFailure({
        method: "GET",
        message: "Container writer projection request failed (403)",
        status: 403,
      }),
    getDocumentWriterProjection: async () => null,
    getDocumentWriterProjectionResult: async () =>
      createMockRequestFailure({
        method: "GET",
        message: "Document writer projection request failed (503)",
        status: 503,
      }),
    linkDocument: async () => null,
    primeDocumentWriterProjection: () => {},
    unlinkDocument: async () => null,
  }) satisfies DocumentLinkSetMutationApi;

  const result = await relinkRemoteDocument({
    apiClient,
    author: null as never,
    contentKey: new Uint8Array(),
    documentId: "dual-failure-document",
    execSql: (async () => []) as never,
    onFailure: (failure) => {
      failures.push({ message: failure.message, status: failure.status });
    },
    operation: "link",
    resolveProjectionUserKey: async () => null,
    targetContainerId: "dual-failure-container",
    targetSecretKey: new Uint8Array(),
  });

  expect(result).toBeNull();
  expect(failures).toEqual([
    {
      message: "Container writer projection request failed (403)",
      status: 403,
    },
  ]);
});

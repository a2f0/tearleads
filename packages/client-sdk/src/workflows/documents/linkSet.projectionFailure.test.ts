import { expect, test } from "bun:test";
import {
  createMockApiClient,
  createMockRequestFailure,
} from "@tearleads/test-utils";
import { CONTAINER_NOT_FOUND_ERROR_CODE } from "@tearleads/validators/response";
import type {
  DocumentLinkSetMutationApi,
  DocumentLinkSetMutationFailure,
} from "../../data/documents/shared/types";
import { relinkRemoteDocument } from "./linkSetRemote";

async function relinkWithProjectionFailures(input: {
  containerFailure: Parameters<typeof createMockRequestFailure>[0];
  documentFailure: Parameters<typeof createMockRequestFailure>[0];
}): Promise<DocumentLinkSetMutationFailure[]> {
  const failures: DocumentLinkSetMutationFailure[] = [];
  const apiClient = createMockApiClient({
    getContainerWriterProjection: async () => null,
    getContainerWriterProjectionResult: async () =>
      createMockRequestFailure({ method: "GET", ...input.containerFailure }),
    getDocumentWriterProjection: async () => null,
    getDocumentWriterProjectionResult: async () =>
      createMockRequestFailure({ method: "GET", ...input.documentFailure }),
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
      failures.push(failure);
    },
    operation: "link",
    resolveProjectionUserKey: async () => null,
    targetContainerId: "dual-failure-container",
    targetSecretKey: new Uint8Array(),
  });
  expect(result).toBeNull();
  return failures;
}

// When both projection fetches fail, every failure reaches the handler and
// the 403 arrives last: any permission denial parks the move (row 7), so a
// non-403 document failure must not mask a container denial — and a
// single-slot consumer that keeps the latest report keeps the denial.
test("a dual projection failure reports both failures, the container 403 last", async () => {
  const failures = await relinkWithProjectionFailures({
    containerFailure: {
      message: "Container writer projection request failed (403)",
      status: 403,
    },
    documentFailure: {
      message: "Document writer projection request failed (503)",
      status: 503,
    },
  });

  expect(failures).toEqual([
    {
      code: undefined,
      message: "Document writer projection request failed (503)",
      status: 503,
    },
    {
      code: undefined,
      message: "Container writer projection request failed (403)",
      status: 403,
    },
  ]);
});

// #2278 #4: the queued-move accumulator classifies a vanished container from
// ANY coded container 404, so a simultaneous document fetch failure must not
// swallow the coded container failure (previously only one was forwarded).
test("a dual projection failure forwards the coded container 404 alongside the document failure", async () => {
  const failures = await relinkWithProjectionFailures({
    containerFailure: {
      code: CONTAINER_NOT_FOUND_ERROR_CODE,
      message: "Container not found",
      status: 404,
    },
    documentFailure: {
      message: "Document writer projection request failed (503)",
      status: 503,
    },
  });

  expect(failures).toEqual([
    {
      code: undefined,
      message: "Document writer projection request failed (503)",
      status: 503,
    },
    {
      code: CONTAINER_NOT_FOUND_ERROR_CODE,
      message: "Container not found",
      status: 404,
    },
  ]);
});

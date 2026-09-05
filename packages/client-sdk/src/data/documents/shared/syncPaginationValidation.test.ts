import { expect, test } from "bun:test";
import type { RequestResult } from "@tearleads/api-client";
import {
  createMockApiClient,
  createMockRequestFailure,
} from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { submitDocumentSync } from "./syncResponses";
import type { DocumentSyncApi, DocumentSyncPlan } from "./types";

const DOCUMENT_ID = "document-pagination-validation";

function page(input: {
  readonly commitLsn: string | null;
  readonly cursor?: string | null | undefined;
  readonly updateId?: string | undefined;
}): DocumentSyncResponse {
  const contentKeyBundle = {
    contentKeyEpoch: 1,
    documentId: DOCUMENT_ID,
    linkSetManifestHash: "manifest-1",
    targetHash: "targets-1",
    targets: [],
  };
  return {
    acceptedOutgoingUpdateIds: [],
    commitLsn: input.commitLsn,
    commitLsnMode: "tracked",
    contentKeyBundle,
    contentKeyBundles: [contentKeyBundle],
    documentId: DOCUMENT_ID,
    documentKekTargets: {
      documentId: DOCUMENT_ID,
      documentKeyTargetHash: "targets-1",
      linkedContainerKeyEpochIds: [],
      linkedContainerManifestHashes: [],
      linkSetManifestHash: "manifest-1",
      targets: [],
    },
    ...(input.cursor === undefined
      ? {}
      : {
          pullPage: {
            hasMore: input.cursor !== null,
            nextCursor: input.cursor,
          },
        }),
    updates:
      input.updateId === undefined
        ? []
        : ([{ id: input.updateId }] as DocumentSyncResponse["updates"]),
  } as DocumentSyncResponse;
}

function plan(): DocumentSyncPlan {
  return {
    documentId: DOCUMENT_ID,
    request: {
      contentKeyEpoch: 1,
      expectedLinkSetManifestHash: "manifest-1",
      expectedTargetHash: "targets-1",
      localVersionVector: null,
      minLsn: "0/1",
      outgoingUpdates: [],
      supportsPullPagination: true,
    } satisfies DocumentSyncRequest,
  } as unknown as DocumentSyncPlan;
}

function apiWithResults(
  results: Array<RequestResult<DocumentSyncResponse>>,
): DocumentSyncApi {
  return createMockApiClient({
    getDocumentWriterProjection: async () => null,
    syncDocument: async () => null,
    syncDocumentResult: async () => {
      const result = results.shift();
      if (!result) throw new Error("Unexpected document sync request");
      return result;
    },
  });
}

test("an empty page can durably advance its continuation cursor", async () => {
  const failure: RequestResult<DocumentSyncResponse> = createMockRequestFailure(
    {
      message: "offline",
      status: null,
    },
  );
  const results = [
    { data: page({ commitLsn: "0/2", cursor: "cursor-2" }), ok: true as const },
    failure,
  ];
  const result = await submitDocumentSync({
    apiClient: apiWithResults(results),
    plan: plan(),
  });

  expect(result?.ok).toBe(true);
  if (!result?.ok) throw new Error("Expected durable cursor progress");
  expect(result.pullComplete).toBe(false);
  expect(results).toHaveLength(1);
});

test("a page without pull metadata is rejected", async () => {
  const submitted = submitDocumentSync({
    apiClient: apiWithResults([
      {
        data: page({ commitLsn: "0/2", updateId: "update-1" }),
        ok: true,
      },
    ]),
    plan: plan(),
  });

  await expect(submitted).rejects.toThrow(
    "Document sync response is missing pull page metadata",
  );
});

test("a terminal unconstrained page may omit its commit checkpoint", async () => {
  const terminalPlan = plan();
  const { minLsn: _minLsn, ...request } = terminalPlan.request;
  terminalPlan.request = request;
  const result = await submitDocumentSync({
    apiClient: apiWithResults([
      {
        data: page({ commitLsn: null, cursor: null }),
        ok: true,
      },
    ]),
    plan: terminalPlan,
  });

  expect(result).toMatchObject({ ok: true, pullComplete: true });
});

test("a resumed page cannot regress its tracked commit checkpoint", async () => {
  const resumedPlan = plan();
  resumedPlan.request = {
    ...resumedPlan.request,
    minLsn: "0/3",
    pullCursor: "cursor-2",
  };
  const submitted = submitDocumentSync({
    apiClient: apiWithResults([
      {
        data: page({
          commitLsn: "0/2",
          cursor: null,
          updateId: "update-2",
        }),
        ok: true,
      },
    ]),
    expectedCommitLsnMode: "tracked",
    plan: resumedPlan,
  });

  await expect(submitted).rejects.toThrow(
    "Document sync continuation commit LSN regressed",
  );
});

test("a first tracked page rejects a malformed checkpoint", async () => {
  const firstPagePlan = plan();
  const { minLsn: _minLsn, ...firstRequest } = firstPagePlan.request;
  firstPagePlan.request = firstRequest;
  const submitted = submitDocumentSync({
    apiClient: apiWithResults([
      {
        data: page({
          commitLsn: "not-an-lsn",
          cursor: "cursor-2",
          updateId: "update-1",
        }),
        ok: true,
      },
    ]),
    plan: firstPagePlan,
  });

  await expect(submitted).rejects.toThrow(
    "Document sync continuation commit LSN is invalid",
  );
});

test("a resumed page cannot return the cursor it consumed", async () => {
  const resumedPlan = plan();
  resumedPlan.request = {
    ...resumedPlan.request,
    minLsn: "0/2",
    pullCursor: "cursor-2",
  };
  const submitted = submitDocumentSync({
    apiClient: apiWithResults([
      {
        data: page({ commitLsn: "0/3", cursor: "cursor-2" }),
        ok: true,
      },
    ]),
    expectedCommitLsnMode: "tracked",
    plan: resumedPlan,
  });

  await expect(submitted).rejects.toThrow(
    "Document sync continuation cursor did not advance",
  );
});

test("one bounded page is returned before another continuation", async () => {
  const fullPage = {
    ...page({ commitLsn: "0/2", cursor: "cursor-2" }),
    updates: Array.from({ length: 64 }, (_, index) => ({
      id: `update-${index}`,
    })) as DocumentSyncResponse["updates"],
  };
  let requestCount = 0;
  const apiClient = createMockApiClient({
    getDocumentWriterProjection: async () => null,
    syncDocument: async () => null,
    syncDocumentResult: async () => {
      requestCount += 1;
      return { data: fullPage, ok: true as const };
    },
  }) satisfies DocumentSyncApi;

  const result = await submitDocumentSync({ apiClient, plan: plan() });

  expect(result?.ok).toBe(true);
  if (!result?.ok) throw new Error("Expected a bounded partial pull");
  expect(result.pullComplete).toBe(false);
  expect(result.response.updates).toHaveLength(64);
  expect(requestCount).toBe(1);
});

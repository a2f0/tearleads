import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import {
  MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES,
} from "@tearleads/validators/util";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function createPaginatedDocumentHistory() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const signed = await Promise.all(
    Array.from({ length: MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES + 1 }, () =>
      createSignedDocumentSyncRequest({ created, owner, root }),
    ),
  );
  const first = signed[0];
  const last = signed.at(-1);
  if (!first || !last) throw new Error("Expected signed update fixtures");

  const firstWrite = await postSync(owner.token, created.id, {
    ...first.request,
    outgoingUpdates: signed
      .slice(0, MAX_DOCUMENT_SYNC_OUTGOING_UPDATES)
      .flatMap(({ request }) => request.outgoingUpdates),
  });
  expect(firstWrite.status).toBe(200);
  const lastWrite = await postSync(owner.token, created.id, last.request);
  expect(lastWrite.status).toBe(200);

  return { created, owner, signed };
}

test("the sync route traverses more than 64 updates exactly once", async () => {
  const { created, owner, signed } = await createPaginatedDocumentHistory();

  const receivedIds: string[] = [];
  let pullCursor: string | undefined;
  let pageCount = 0;
  do {
    const response = await postSync(owner.token, created.id, {
      contentKeyEpoch: created.contentKeyBundle.contentKeyEpoch,
      expectedLinkSetManifestHash: created.contentKeyBundle.linkSetManifestHash,
      expectedTargetHash: created.contentKeyBundle.targetHash,
      localVersionVector: null,
      outgoingUpdates: [],
      ...(pullCursor === undefined ? {} : { pullCursor }),
      supportsPullPagination: true,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as DocumentSyncResponse;
    receivedIds.push(...body.updates.map(({ id }) => id));
    pullCursor = body.pullPage.nextCursor ?? undefined;
    pageCount += 1;
  } while (pullCursor !== undefined);

  expect(pageCount).toBe(2);
  expect(receivedIds).toHaveLength(signed.length);
  expect(new Set(receivedIds)).toEqual(
    new Set(signed.map(({ updateId }) => updateId)),
  );
});

test("a lost continuation response retries without skipped or duplicated updates", async () => {
  const { created, owner, signed } = await createPaginatedDocumentHistory();

  const initialRequest: DocumentSyncRequest = {
    contentKeyEpoch: created.contentKeyBundle.contentKeyEpoch,
    expectedLinkSetManifestHash: created.contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: created.contentKeyBundle.targetHash,
    localVersionVector: null,
    outgoingUpdates: [],
    supportsPullPagination: true,
  };
  const firstPageResponse = await postSync(
    owner.token,
    created.id,
    initialRequest,
  );
  expect(firstPageResponse.status).toBe(200);
  const firstPage = (await firstPageResponse.json()) as DocumentSyncResponse;
  expect(firstPage.pullPage.hasMore).toBe(true);
  if (!firstPage.pullPage.nextCursor) {
    throw new Error("Expected a continuation cursor");
  }

  const continuationRequest: DocumentSyncRequest = {
    ...initialRequest,
    pullCursor: firstPage.pullPage.nextCursor,
  };
  const lostResponse = await postSync(
    owner.token,
    created.id,
    continuationRequest,
  );
  expect(lostResponse.status).toBe(200);
  const lostPage = (await lostResponse.json()) as DocumentSyncResponse;

  const retryResponse = await postSync(
    owner.token,
    created.id,
    continuationRequest,
  );
  expect(retryResponse.status).toBe(200);
  const retriedPage = (await retryResponse.json()) as DocumentSyncResponse;
  expect(retriedPage.pullPage).toEqual({ hasMore: false, nextCursor: null });
  expect(retriedPage.updates.map(({ id }) => id)).toEqual(
    lostPage.updates.map(({ id }) => id),
  );

  // The lost page is observed only by the test. Convergence includes its retry.
  const convergedIds = [...firstPage.updates, ...retriedPage.updates].map(
    ({ id }) => id,
  );
  expect(convergedIds).toHaveLength(signed.length);
  expect(new Set(convergedIds).size).toBe(convergedIds.length);
  expect(new Set(convergedIds)).toEqual(
    new Set(signed.map(({ updateId }) => updateId)),
  );
});

function postSync(
  token: string,
  documentId: string,
  request: DocumentSyncRequest,
) {
  return routeApp.request(`/documents/${documentId}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

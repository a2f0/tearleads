import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import {
  MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES,
  parseWalLsn,
} from "@tearleads/validators/util";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  commitLsnEvents,
  traceSyncQueries,
  updateUpperBoundIndex,
} from "../../../test/helpers/syncQueryTrace";
import { readCurrentCommitLsn } from "../../documents/commitLsn";
import { createRouteApp, routeApp } from "../../routeApp";
import { getDefaultApiServiceRuntime } from "../../services/runtime";

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
      contentKeyEpoch: created.contentKeyEpoch,
      expectedLinkSetManifestHash: created.manifestHash,
      expectedTargetHash: created.targetHash,
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
    contentKeyEpoch: created.contentKeyEpoch,
    expectedLinkSetManifestHash: created.manifestHash,
    expectedTargetHash: created.targetHash,
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

test("each paginated sync checks supplied minLsn once before its snapshot", async () => {
  const { created, owner, signed } = await createPaginatedDocumentHistory();
  const minLsn = await readCurrentCommitLsn(db);
  let pullCursor: string | undefined;
  const receivedIds: string[] = [];
  do {
    const { events, result: response } = await traceSyncQueries(
      db,
      async (database) =>
        postSync(
          owner.token,
          created.id,
          {
            contentKeyEpoch: created.contentKeyEpoch,
            expectedLinkSetManifestHash: created.manifestHash,
            expectedTargetHash: created.targetHash,
            localVersionVector: null,
            minLsn,
            outgoingUpdates: [],
            ...(pullCursor === undefined ? {} : { pullCursor }),
            supportsPullPagination: true,
          },
          createRouteApp({
            runtime: { ...getDefaultApiServiceRuntime(), db: database },
          }),
        ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as DocumentSyncResponse;
    expect(body.commitLsnMode).toBe("tracked");
    if (body.commitLsn === null)
      throw new Error("Expected a tracked commit LSN");
    expect(parseWalLsn(body.commitLsn)).toBeGreaterThanOrEqual(
      parseWalLsn(minLsn),
    );
    const lsnQueries = commitLsnEvents(events);
    const inTransaction = lsnQueries.filter(
      (event) => event.scope === "transaction",
    );
    const afterTransaction = lsnQueries.filter(
      (event) => event.scope === "root",
    );
    console.info(
      "sync-min-lsn-budget",
      JSON.stringify({
        page: pullCursor === undefined ? "first" : "continuation",
        inTransaction: inTransaction.length,
        afterTransaction: afterTransaction.length,
      }),
    );
    expect(
      inTransaction,
      "one in-transaction minimum-LSN query per paged sync",
    ).toHaveLength(1);
    expect(afterTransaction).toHaveLength(1);
    const guardIndex = inTransaction[0] ? events.indexOf(inTransaction[0]) : -1;
    const upperBoundIndex = updateUpperBoundIndex(events);
    const committedIndex = events.findIndex(
      (event) => event.kind === "committed",
    );
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(upperBoundIndex).toBeGreaterThan(guardIndex);
    expect(committedIndex).toBeGreaterThan(upperBoundIndex);
    expect(
      afterTransaction[0] ? events.indexOf(afterTransaction[0]) : -1,
    ).toBeGreaterThan(committedIndex);
    receivedIds.push(...body.updates.map(({ id }) => id));
    pullCursor = body.pullPage.nextCursor ?? undefined;
  } while (pullCursor !== undefined);
  expect(receivedIds).toHaveLength(signed.length);
  expect(new Set(receivedIds)).toEqual(
    new Set(signed.map(({ updateId }) => updateId)),
  );
});

function postSync(
  token: string,
  documentId: string,
  request: DocumentSyncRequest,
  app = routeApp,
) {
  return app.request(`/documents/${documentId}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

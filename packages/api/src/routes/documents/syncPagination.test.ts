import { expect, test } from "bun:test";
import { createTestUser } from "@symcrypt/bob-and-alice";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";
import {
  MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES,
} from "@symcrypt/validators/util";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("the sync route traverses more than 64 updates exactly once", async () => {
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
      supportsUntrackedCommitLsn: true,
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

import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES } from "@tearleads/validators/util";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function documentWithThreeUpdates() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const signed = await Promise.all(
    Array.from({ length: 3 }, () =>
      createSignedDocumentSyncRequest({ created, owner, root }),
    ),
  );
  const [first] = signed;
  if (!first) throw new Error("Expected signed update fixtures");
  const write = await postSync(owner.token, created.id, {
    ...first.request,
    outgoingUpdates: signed.flatMap(({ request }) => request.outgoingUpdates),
  });
  expect(write.status).toBe(200);
  return { created, owner, signed };
}

function pullRequest(
  created: Awaited<ReturnType<typeof createDocument>>,
  extra: Partial<DocumentSyncRequest>,
): DocumentSyncRequest {
  return {
    contentKeyEpoch: created.contentKeyEpoch,
    expectedLinkSetManifestHash: created.manifestHash,
    expectedTargetHash: created.targetHash,
    localVersionVector: null,
    outgoingUpdates: [],
    supportsPullPagination: true,
    ...extra,
  };
}

// A client isolating the updates a process death left unattributed reads
// each alone, so a later death counts toward the one update it died on.
test("a pull with a page limit of one serves each update on its own page", async () => {
  const { created, owner, signed } = await documentWithThreeUpdates();

  const pages: string[][] = [];
  let pullCursor: string | undefined;
  do {
    const response = await postSync(
      owner.token,
      created.id,
      pullRequest(created, {
        maxPageUpdates: 1,
        ...(pullCursor === undefined ? {} : { pullCursor }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as DocumentSyncResponse;
    pages.push(body.updates.map(({ id }) => id));
    pullCursor = body.pullPage.nextCursor ?? undefined;
  } while (pullCursor !== undefined);

  expect(pages).toEqual(signed.map(({ updateId }) => [updateId]));
});

test("a page limit above the server's own is refused", async () => {
  const { created, owner } = await documentWithThreeUpdates();
  const response = await postSync(
    owner.token,
    created.id,
    pullRequest(created, {
      maxPageUpdates: MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES + 1,
    }),
  );
  expect(response.status).toBe(400);
});

function postSync(token: string, documentId: string, request: unknown) {
  return routeApp.request(`/documents/${documentId}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

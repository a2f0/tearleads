import { expect, test } from "bun:test";
import { createTestUser } from "@symcrypt/bob-and-alice";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import {
  type DocumentLinkSetMutationResponse,
  type DocumentSyncResponse,
  isDocumentLinkSetMutationResponse,
  isDocumentSyncResponse,
} from "@symcrypt/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../../test/helpers/documentLinkMutation";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

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

test("raw-history sync bypasses an otherwise dominant rotation baseline", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const created = await createDocument({ owner, root });
  const { request: writeRequest, updateId } =
    await createSignedDocumentSyncRequest({ created, owner, root });
  expect((await postSync(owner.token, created.id, writeRequest)).status).toBe(
    200,
  );

  const linkRequest = await buildDocumentLinkRequest({
    child,
    createdDocument: created,
    owner,
    root,
  });
  const linkResponse = await routeApp.request(`/documents/${created.id}/link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(linkRequest),
  });
  expect(linkResponse.status).toBe(200);
  const linked = (await linkResponse.json()) as DocumentLinkSetMutationResponse;
  expect(isDocumentLinkSetMutationResponse(linked)).toBe(true);

  const unlinkRequest = await buildDocumentUnlinkRequest({
    child,
    linkedDocument: linked,
    owner,
    root,
  });
  const rotationBaselineId = unlinkRequest.rotationBaseline?.id;
  if (!rotationBaselineId) {
    throw new Error("Expected unlink rotation baseline");
  }
  const unlinkResponse = await routeApp.request(
    `/documents/${created.id}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(unlinkRequest),
    },
  );
  expect(unlinkResponse.status).toBe(200);
  const unlinked =
    (await unlinkResponse.json()) as DocumentLinkSetMutationResponse;
  expect(isDocumentLinkSetMutationResponse(unlinked)).toBe(true);

  const readRequest = {
    contentKeyEpoch: unlinked.contentKeyBundle.contentKeyEpoch,
    expectedLinkSetManifestHash: unlinked.contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: unlinked.contentKeyBundle.targetHash,
    localVersionVector: null,
    outgoingUpdates: [],
    supportsPullPagination: true,
  } satisfies DocumentSyncRequest;
  const normalResponse = await postSync(owner.token, created.id, readRequest);
  expect(normalResponse.status).toBe(200);
  const normal = (await normalResponse.json()) as DocumentSyncResponse;
  expect(isDocumentSyncResponse(normal)).toBe(true);
  expect(normal.updates.map(({ id }) => id)).toEqual([rotationBaselineId]);

  const rawResponse = await postSync(owner.token, created.id, {
    ...readRequest,
    historyMode: "raw",
  });
  expect(rawResponse.status).toBe(200);
  const raw = (await rawResponse.json()) as DocumentSyncResponse;
  expect(isDocumentSyncResponse(raw)).toBe(true);
  expect(raw.updates.map(({ id }) => id)).toContain(updateId);
  expect(raw.updates.map(({ id }) => id)).toContain(rotationBaselineId);
  const bundleEpochs = new Set(
    raw.contentKeyBundles.map(({ contentKeyEpoch }) => contentKeyEpoch),
  );
  expect(
    raw.updates.every(({ writeHeader }) =>
      bundleEpochs.has(Number(Reflect.get(writeHeader, "contentKeyEpoch"))),
    ),
  ).toBe(true);
});

import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { signWriteHeader, type WriteHeader } from "@tearleads/crypto";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { listDocumentContentWriteDependencyHashes } from "../../access/read/contentWriteDependencies";
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

test("the API requires exact signed write paths and retains their dependency bundles", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const created = await createDocument({ owner, root });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const update = request.outgoingUpdates[0];
  if (!update) throw new Error("Expected outgoing update");
  const paths = [
    [
      {
        containerId: root.kekState.containerId,
        manifestHash: root.bundle.manifestHash,
      },
    ],
    [
      {
        containerId: root.kekState.containerId,
        manifestHash: root.bundle.manifestHash,
      },
      {
        containerId: child.containerId,
        manifestHash: child.accessManifest.manifestHash,
      },
    ],
  ];
  // An unsigned extra path fails exact citation coverage first.
  const extraPathRequest = { ...request, authorizingContainerPathRefs: paths };
  expect(
    (await postSync(owner.token, created.id, extraPathRequest)).status,
  ).toBe(409);
  const { signature: _signature, ...unsigned } =
    update.writeHeader as unknown as WriteHeader;
  const hashes = [
    root.bundle.manifestHash,
    child.accessManifest.manifestHash,
  ].sort();
  const signed = await signWriteHeader(
    { ...unsigned, dependencyManifestHashes: hashes },
    owner.signing.signingPrivateKey,
  );
  const unrelated = await postSync(owner.token, created.id, {
    ...extraPathRequest,
    outgoingUpdates: [{ ...update, writeHeader: { ...signed } }],
  });
  expect(unrelated.status).toBe(400);
  // Signing an unrelated child does not bring it into this document scope.
  expect((await postSync(owner.token, created.id, request)).status).toBe(200);
  expect(
    await listDocumentContentWriteDependencyHashes(created.id, db),
  ).toEqual([root.bundle.manifestHash]);

  // The refused child citation must never enter the retained proof bundle.
  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: { Authorization: `Bearer ${owner.token}` },
    },
  );
  expect(projectionResponse.status).toBe(200);
  const material =
    (await projectionResponse.json()) as DocumentWriterProjectionResponse;
  expect(
    material.documentManifestContainerPaths
      .flat()
      .map((bundle) => bundle.manifestHash),
  ).not.toContain(child.accessManifest.manifestHash);
});

test("a document retains the signed path dependencies of its attachment content", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const document = await createDocument({ owner, root });
  expect(
    await listDocumentContentWriteDependencyHashes(document.id, db),
  ).toEqual([]);
  const blobId = crypto.randomUUID();
  const stagedBlob = await stageBlob(owner, blobId);
  const { request } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob,
  });
  await bindForTest({ blobId, owner, request });
  const documentWrite = await createSignedDocumentSyncRequest({
    created: document,
    owner,
    root,
  });
  expect(
    (await postSync(owner.token, document.id, documentWrite.request)).status,
  ).toBe(200);
  // Document and blob headers cite the same root: the SQL union returns it once.
  expect(
    await listDocumentContentWriteDependencyHashes(document.id, db),
  ).toEqual([root.bundle.manifestHash]);
});

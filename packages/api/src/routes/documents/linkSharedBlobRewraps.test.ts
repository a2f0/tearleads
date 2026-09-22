import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { contentKeyEnvelopeFixture } from "../../../test/helpers/contentKeyEnvelope";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { getLatestBlobContentKeyBundle } from "../../access/read/blobContentKeyStore";
import { routeApp } from "../../routeApp";
import { readKeyingCanonicalJson } from "../../utils/canonicalJson";

test("linking one document preserves another document's wraps for their shared blob", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const first = await createDocument({ owner, root });
  const second = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const initial = await buildBind({
    blobId,
    document: first,
    owner,
    root,
    stagedBlob: await stageBlob(owner, blobId),
  });
  await bindForTest({ blobId, owner, request: initial.request });
  const shared = await buildBind({
    activeBindings: [initial.binding],
    blobId,
    document: second,
    documents: [first, second],
    owner,
    root,
  });
  await bindForTest({ blobId, owner, request: shared.request });
  const before = await getLatestBlobContentKeyBundle(blobId, db);
  const rawTarget = initial.request.contentKeyBundle.targets[0];
  if (!before || !rawTarget) throw new Error("Expected shared blob wraps");
  const target = {
    ...rawTarget,
    wrappingMetadata: readKeyingCanonicalJson(
      rawTarget.wrappingMetadata,
      "test wrap",
    ),
  };
  const childKek = kekStateFromContainerResponse(child);
  const link = await buildDocumentLinkRequest({
    child,
    createdDocument: first,
    owner,
    root,
    blobRewraps: [
      {
        blobId,
        contentKeyEpoch: 1,
        targets: [
          target,
          {
            ...target,
            containerId: child.containerId,
            containerManifestHash: childKek.accessManifestHash,
            containerKeyEpochId: childKek.containerKeyEpochId,
            containerKeyEpoch: childKek.containerKeyEpoch,
            wrappedKey: contentKeyEnvelopeFixture(
              "Blob",
              "first-document-child-wrap",
            ).wrappedKey,
          },
        ],
      },
    ],
  });
  const response = await routeApp.request(`/documents/${first.id}/link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(link),
  });
  expect({
    status: response.status,
    body: await response.json(),
  }).toMatchObject({
    status: 200,
  });
  const after = await getLatestBlobContentKeyBundle(blobId, db);
  expect(
    before.targets.filter((wrap) => wrap.documentId === second.id),
  ).toHaveLength(1);
  expect(
    after?.targets.filter((wrap) => wrap.documentId === second.id),
  ).toEqual(before.targets.filter((wrap) => wrap.documentId === second.id));
  expect(
    after?.targets.filter((wrap) => wrap.documentId === first.id),
  ).toHaveLength(2);
});

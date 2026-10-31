import { expect, test } from "bun:test";
import { readKeyingCanonicalJson } from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import { isDocumentLinkSetMutationResponse } from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  buildDetach,
  detachForTest,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { contentKeyEnvelopeFixture } from "../../../test/helpers/contentKeyEnvelope";
import { withDocumentMutationArtifacts } from "../../../test/helpers/documentAcknowledgementFixture";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../../test/helpers/documentLinkMutation";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

// A move's unlink leg re-cites the envelopes its link leg committed instead of
// listing the attachments again (client-sdk `reuseCommittedBlobRewraps`). The
// API is what keeps that safe: a re-cited rewrap that no longer matches the
// active attachment set or its content-key epoch is refused with an uncoded
// 409, which the client answers by listing and retrying once.
async function linkedDocumentWithAttachment() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const document = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const { binding, request: bind } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob: await stageBlob(owner, blobId),
  });
  await bindForTest({ blobId, owner, request: bind });
  const post = async (operation: "link" | "unlink", request: unknown) => {
    const response = await routeApp.request(
      `/documents/${document.id}/${operation}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${owner.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      },
    );
    return { body: await response.json(), status: response.status };
  };
  const rawTarget = bind.contentKeyBundle.targets[0];
  if (!rawTarget) throw new Error("Expected initial blob target");
  const rootEnvelope = {
    ...rawTarget,
    wrappingMetadata: readKeyingCanonicalJson(
      rawTarget.wrappingMetadata,
      "test wrap",
    ),
  };
  const childKek = await kekStateFromContainerResponse(child);
  // The link leg: what the client records as committed.
  const committed = [
    {
      blobId,
      contentKeyEpoch: 1,
      targets: [
        rootEnvelope,
        {
          ...rootEnvelope,
          containerId: child.containerId,
          containerManifestHash: childKek.accessManifestHash,
          containerKeyEpochId: childKek.containerKeyEpochId,
          containerKeyEpoch: childKek.containerKeyEpoch,
          wrappedKey: contentKeyEnvelopeFixture("Blob", "reuse-child-wrap")
            .wrappedKey,
        },
      ],
    },
  ];
  const linkRequest = await buildDocumentLinkRequest({
    child,
    createdDocument: document,
    owner,
    root,
    blobRewraps: committed,
  });
  const linked = await post("link", linkRequest);
  expect(linked.status).toBe(200);
  if (!isDocumentLinkSetMutationResponse(linked.body))
    throw new Error("Expected linked document");
  const linkedDocument = withDocumentMutationArtifacts(
    linkRequest,
    linked.body,
  );
  // The unlink leg keeps the root and re-cites the root envelope it committed.
  const unlinkReusing = (contentKeyEpoch = 1) =>
    buildDocumentUnlinkRequest({
      child,
      linkedDocument,
      owner,
      root,
      blobRewraps: [{ blobId, contentKeyEpoch, targets: [rootEnvelope] }],
    });
  return {
    binding,
    blobId,
    document: { ...document, ...linkedDocument },
    owner,
    post,
    root,
    unlinkReusing,
  };
}

test("an unlink re-citing the link leg's envelopes commits", async () => {
  const fixture = await linkedDocumentWithAttachment();
  const unlinked = await fixture.post("unlink", await fixture.unlinkReusing());
  expect(unlinked.status).toBe(200);
}, 30_000);

test("a re-cited rewrap is refused, uncoded, after a detach between legs", async () => {
  const fixture = await linkedDocumentWithAttachment();
  await detachForTest({
    binding: fixture.binding,
    blobId: fixture.blobId,
    owner: fixture.owner,
    request: await buildDetach({
      binding: fixture.binding,
      document: fixture.document,
      owner: fixture.owner,
      root: fixture.root,
    }),
  });
  const refused = await fixture.post("unlink", await fixture.unlinkReusing());
  expect(refused).toEqual({
    body: {
      error:
        "Document attachments changed; retry the link with current blob keys",
    },
    status: 409,
  });
}, 30_000);

test("a re-cited rewrap naming another content-key epoch is refused, uncoded", async () => {
  const fixture = await linkedDocumentWithAttachment();
  const refused = await fixture.post("unlink", await fixture.unlinkReusing(2));
  expect(refused).toEqual({
    body: { error: "Blob content key epoch changed" },
    status: 409,
  });
}, 30_000);

import { expect } from "bun:test";
import { withDatabaseStatementCounter } from "@tearleads/api-shared/postgres";
import { readKeyingCanonicalJson } from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import { routeApp } from "../../src/routeApp";
import { authenticate } from "./authenticate";
import { bindForTest, buildBind, stageBlob } from "./blobAttachmentKit";
import { createChild } from "./containerMutationRoutes";
import { contentKeyEnvelopeFixture } from "./contentKeyEnvelope";
import { withDocumentMutationArtifacts } from "./documentAcknowledgementFixture";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "./documentLinkMutation";
import { createSignedDocumentSyncRequest } from "./documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
  kekStateFromContainerResponse,
} from "./keyingWriterProjectionKit";
import { registerUser } from "./registerUser";
import { postDocumentSync } from "./staleBundleHealKit";

export async function blobBudgetOwner() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  // Hold root-before-child ordering fixed for preauthorization's sorted walk.
  // Incrementing the first non-f hex digit keeps a distinct valid UUID and
  // avoids repeated constant IDs across tests sharing one database.
  const containerId = root.kekState.containerId.replace(/[0-9a-e]/, (digit) =>
    (Number.parseInt(digit, 16) + 1).toString(16),
  );
  expect(root.kekState.containerId < containerId).toBe(true);
  const child = await createChild({
    containerId,
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  return {
    owner,
    root,
    child,
    childKek: await kekStateFromContainerResponse(child),
  };
}

type Owner = Awaited<ReturnType<typeof blobBudgetOwner>>;

async function attachment(
  input: Owner & {
    document: Awaited<ReturnType<typeof createDocument>>;
    index: number;
  },
) {
  const blobId = crypto.randomUUID();
  const { request } = await buildBind({
    ...input,
    blobId,
    slotId: `slot-${input.index}`,
    stagedBlob: await stageBlob(input.owner, blobId),
  });
  await bindForTest({ blobId, owner: input.owner, request });
  const rawTarget = request.contentKeyBundle.targets[0];
  if (!rawTarget) throw new Error("Expected bound root target");
  const target = {
    ...rawTarget,
    wrappingMetadata: readKeyingCanonicalJson(
      rawTarget.wrappingMetadata,
      "wrap",
    ),
  };
  const childTarget = {
    ...target,
    containerId: input.child.containerId,
    containerManifestHash: input.childKek.accessManifestHash,
    containerKeyEpochId: input.childKek.containerKeyEpochId,
    containerKeyEpoch: input.childKek.containerKeyEpoch,
    wrappedKey: contentKeyEnvelopeFixture("Blob", `unlink-child-${input.index}`)
      .wrappedKey,
  };
  return { blobId, target, childTarget };
}

export async function prepareBlobUnlink(
  input: Owner & { attachments: number; committed: boolean },
) {
  const document = await createDocument(input);
  const blobs = [];
  for (let index = 0; index < input.attachments; index += 1)
    blobs.push(await attachment({ ...input, document, index }));
  if (input.committed) {
    const sync = await createSignedDocumentSyncRequest({
      ...input,
      created: document,
    });
    expect(
      (await postDocumentSync(input.owner, document.id, sync.request)).status,
    ).toBe(200);
  }
  const post = async (operation: "link" | "unlink", request: unknown) => {
    const response = await routeApp.request(
      `/documents/${document.id}/${operation}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.owner.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      },
    );
    return { status: response.status, body: await response.json() };
  };
  const link = await buildDocumentLinkRequest({
    ...input,
    createdDocument: document,
    blobRewraps: blobs.map(({ blobId, target, childTarget }) => ({
      blobId,
      contentKeyEpoch: 1,
      targets: [target, childTarget],
    })),
  });
  const counter = { statements: 0 };
  const linked = await withDatabaseStatementCounter(counter, () =>
    post("link", link),
  );
  expect(linked.status).toBe(200);
  expect(linked.body.manifestHash).toBe(link.expectedManifestHash);
  expect(linked.body.contentKeyEpoch).toBe(document.contentKeyEpoch);
  const unlink = await buildDocumentUnlinkRequest({
    ...input,
    linkedDocument: withDocumentMutationArtifacts(link, linked.body),
    blobRewraps: blobs.map(({ blobId, target }) => ({
      blobId,
      contentKeyEpoch: 1,
      targets: [target],
    })),
  });
  if (!input.committed) delete unlink.rotationBaseline;
  return { blobs, document, post, unlink, linkStatements: counter.statements };
}

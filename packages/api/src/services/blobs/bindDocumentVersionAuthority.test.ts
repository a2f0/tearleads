import { expect, test } from "bun:test";
import type { VerifiedDocumentLinkSetManifest } from "@tearleads/crypto";
import { emptyVersionVector } from "@tearleads/loro";
import { createTestUser } from "@tearleads/test-utils";
import type { AccessManifestBundleWire } from "@tearleads/validators/request";
import {
  BLOB_MUTATION_ERROR_CODES,
  isContainerMutationResponse,
} from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  blobAttachmentTestRuntime,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { buildContainerGrantRequest } from "../../../test/helpers/containerGrantMutation";
import { buildChildCreateRequest } from "../../../test/helpers/containerMutationArtifactKit";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  accessManifestFromContainerResponse,
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
  createSignedAccessEvent,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { routeApp } from "../../routeApp";
import { BlobMutationError, bindBlobAttachment } from "./blobMutations";

function postAs(token: string, path: string, body: unknown) {
  return routeApp.request(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** An owner's root and a child container the owner shares with a writer. */
async function organizationWithSharedChild() {
  const owner = createTestUser();
  const writer = createTestUser();
  for (const user of [owner, writer]) {
    await registerUser(user);
    await authenticate(user);
  }
  const root = await bootstrapRoot(owner);
  const created = await postAs(
    owner.token,
    "/containers",
    await buildChildCreateRequest({ root, signer: owner }),
  );
  expect(created.status).toBe(200);
  const child = await created.json();
  invariant(isContainerMutationResponse(child), "expected child container");
  const childManifest = await accessManifestFromContainerResponse(child);
  const granted = await postAs(
    owner.token,
    `/containers/${child.containerId}/share`,
    await buildContainerGrantRequest({
      previous: childManifest,
      previousKekState: await kekStateFromContainerResponse(child),
      previousContainerPath: [root.bundle, childManifest],
      parentKekState: root.kekState,
      recipient: writer,
      signer: owner,
      accessLevel: "write",
    }),
  );
  expect(granted.status).toBe(200);
  const shared = await granted.json();
  invariant(isContainerMutationResponse(shared), "expected shared child");
  const currentRoot = await bootstrapRoot(owner);
  const writerRoot = {
    ...currentRoot,
    bundle: await accessManifestFromContainerResponse(shared),
    kekState: await kekStateFromContainerResponse(shared),
  };
  const writerPath: readonly AccessManifestBundleWire[] = [
    currentRoot.bundle,
    writerRoot.bundle,
  ];
  return { owner, root: currentRoot, writer, writerPath, writerRoot };
}

test("a member without write access learns nothing about a document's updates", async () => {
  const org = await organizationWithSharedChild();
  // A document in the owner's root, which the writer cannot write, with a
  // committed update.
  const document = await createDocument({ owner: org.owner, root: org.root });
  const { request: update } = await createSignedDocumentSyncRequest({
    created: document,
    owner: org.owner,
    root: org.root,
  });
  expect((await postDocumentSync(org.owner, document.id, update)).status).toBe(
    200,
  );

  // The writer signs a bind of its own staged bytes that names that
  // document at its current manifest, authorized by the writer's own current
  // path, at a version that lacks the committed update.
  const writable = await createDocument({
    containerPath: [...org.writerPath],
    owner: org.writer,
    root: org.writerRoot,
  });
  const blobId = crypto.randomUUID();
  const { request } = await buildBind({
    blobId,
    containerPath: [...org.writerPath],
    document: writable,
    owner: org.writer,
    root: org.writerRoot,
    stagedBlob: await stageBlob(org.writer, blobId),
  });
  const manifest =
    document.accessManifest as unknown as VerifiedDocumentLinkSetManifest;
  const manifestHash = manifest.manifestHash;
  const body = {
    ...(request.body as Record<string, unknown>),
    documentId: document.id,
    documentManifestHash: manifestHash,
  };
  const { event } = await createSignedAccessEvent({
    body: body as never,
    dependencyManifestHashes: [
      manifestHash,
      ...org.writerPath.map((head) => head.manifestHash),
    ],
    objectId: blobId,
    objectKind: "blob",
    organizationId: manifest.state.organizationId,
    previousManifestHash: null,
    signer: org.writer,
  });

  const refusal = await bindBlobAttachment(blobAttachmentTestRuntime, {
    blobId,
    fingerprint: org.writer.fingerprint,
    request: {
      ...request,
      body,
      // Key targets naming the document and the container it is linked to.
      contentKeyBundle: {
        ...request.contentKeyBundle,
        targets: request.contentKeyBundle.targets.slice(0, 1).map((target) => ({
          ...target,
          containerId: asVerifiedContainerManifest(org.root.bundle).state
            .containerId,
          documentId: document.id,
        })),
      },
      documentVersionVector: emptyVersionVector(),
      event: event as unknown as Record<string, unknown>,
    },
    sessionId: "bind-document-version-authority-test",
    userId: org.writer.userId,
  }).catch((error: unknown) => error);

  // Verifying the signed bind refuses it before anything reads the
  // document's updates, so the refusal never names a newer document.
  expect(refusal).toBeInstanceOf(BlobMutationError);
  expect(refusal).not.toMatchObject({
    code: BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
  });
}, 30_000);

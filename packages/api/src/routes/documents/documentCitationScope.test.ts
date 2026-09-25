import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  computeAccessManifestHash,
  deriveDocumentLinkSetManifest,
} from "@tearleads/crypto";
import { isDocumentLinkSetMutationResponse } from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../../test/helpers/documentLinkMutation";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
  createDocumentRequest,
  createSignedAccessEvent,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("document creation cannot commit an unrelated organization citation", async () => {
  const owner = createTestUser();
  const other = createTestUser();
  for (const user of [owner, other]) {
    await registerUser(user);
    await authenticate(user);
  }
  const root = await bootstrapRoot(owner);
  const foreign = await bootstrapRoot(other);
  const documentId = crypto.randomUUID();
  const request = await createDocumentRequest({ documentId, owner, root });
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  const event = await createSignedAccessEvent({
    body: {
      eventType: "document.link",
      containerId: root.kekState.containerId,
      containerManifestHash: root.bundle.manifestHash,
      blobRewraps: [],
    },
    dependencyManifestHashes: [
      root.bundle.manifestHash,
      foreign.bundle.manifestHash,
    ],
    objectId: documentId,
    objectKind: "document",
    organizationId,
    previousManifestHash: null,
    signer: owner,
  });
  const manifest = await deriveDocumentLinkSetManifest({
    version: 1,
    documentId,
    organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: event.eventHash,
    linkedContainerIds: [root.kekState.containerId],
  });
  const manifestHash = await computeAccessManifestHash(manifest);
  const post = (body: unknown) =>
    routeApp.request("/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const refused = await post({
    ...request,
    event: event.event,
    manifest,
    expectedManifestHash: manifestHash,
    authorizingContainerPathRefs: [
      [
        {
          containerId: foreign.kekState.containerId,
          manifestHash: foreign.bundle.manifestHash,
        },
      ],
    ],
    contentKeyBundle: {
      ...request.contentKeyBundle,
      linkSetManifestHash: manifestHash,
    },
  });
  expect(refused.status).toBe(400);
  expect(await refused.text()).toContain("outside the document scope");
  expect((await post(request)).status).toBe(200);
  expect(
    (
      await routeApp.request(`/documents/${documentId}/writer-projection`, {
        headers: { Authorization: `Bearer ${owner.token}` },
      })
    ).status,
  ).toBe(200);
});

test("a relink racing an unlink returns retryable stale state", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const target = await createChildContainer({ parent: root, signer: owner });
  const created = await createDocument({ owner, root });
  const post = (operation: "link" | "unlink", request: unknown) =>
    routeApp.request(`/documents/${created.id}/${operation}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  const first = await post(
    "link",
    await buildDocumentLinkRequest({
      child,
      createdDocument: created,
      owner,
      root,
    }),
  );
  expect(first.status).toBe(200);
  const linked = await first.json();
  if (!isDocumentLinkSetMutationResponse(linked))
    throw new Error("Expected linked document");
  const childBundle = child.accessManifest;
  const stale = await buildDocumentLinkRequest({
    child: target,
    createdDocument: { ...linked, createdAt: created.createdAt },
    owner,
    root,
    authorizingContainerPath: [root.bundle, childBundle],
  });
  const removed = await post(
    "unlink",
    await buildDocumentUnlinkRequest({
      child,
      linkedDocument: linked,
      owner,
      root,
    }),
  );
  expect(removed.status).toBe(200);
  const refused = await post("link", stale);
  expect(refused.status).toBe(409);
  expect(await refused.text()).toContain("previous manifest");
});

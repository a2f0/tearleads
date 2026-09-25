import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  computeAccessManifestHash,
  deriveDocumentLinkSetManifest,
} from "@tearleads/crypto";
import { authenticate } from "../../test/helpers/authenticate";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocumentRequest,
  createSignedAccessEvent,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { routeApp } from "../routeApp";

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
  expect(await refused.text()).toContain("authorizing");
  expect((await post(request)).status).toBe(200);
  expect(
    (
      await routeApp.request(`/documents/${documentId}/writer-projection`, {
        headers: { Authorization: `Bearer ${owner.token}` },
      })
    ).status,
  ).toBe(200);
});

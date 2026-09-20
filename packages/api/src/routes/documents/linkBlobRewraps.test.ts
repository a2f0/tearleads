import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { blobContentKeyTargets } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { normalizeDocumentAccessEventBody } from "@tearleads/crypto";
import { isDocumentLinkSetMutationResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { contentKeyEnvelopeFixture } from "../../../test/helpers/contentKeyEnvelope";
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
import { getCurrentAccessManifestHead } from "../../access/read/accessManifestStore";
import { routeApp } from "../../routeApp";
import { readKeyingCanonicalJson } from "../../utils/canonicalJson";

test("link and unlink atomically cover active blob bindings and retain prior wraps", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const document = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const stagedBlob = await stageBlob(owner);
  const { request: bind } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob,
  });
  await bindForTest({ blobId, owner, request: bind });
  const post = (operation: "link" | "unlink", request: unknown) =>
    routeApp.request(`/documents/${document.id}/${operation}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  const missing = await buildDocumentLinkRequest({
    child,
    createdDocument: document,
    owner,
    root,
  });
  expect((await post("link", missing)).status).toBe(409);
  expect(
    (await getCurrentAccessManifestHead("document", document.id, db))
      ?.manifestHash,
  ).toBe(document.accessManifest.manifestHash);
  const childKek = kekStateFromContainerResponse(child);
  const rawTarget = bind.contentKeyBundle.targets[0];
  if (!rawTarget) throw new Error("Expected initial blob target");
  const target = {
    ...rawTarget,
    wrappingMetadata: readKeyingCanonicalJson(
      rawTarget.wrappingMetadata,
      "test wrap",
    ),
  };
  const blobRewraps = [
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
          wrappedKey: contentKeyEnvelopeFixture("Blob", "new-child-wrap")
            .wrappedKey,
        },
      ],
    },
  ];
  const link = await buildDocumentLinkRequest({
    child,
    createdDocument: document,
    owner,
    root,
    blobRewraps,
  });
  const tampered = structuredClone(link);
  Reflect.set(tampered, "body", {
    ...normalizeDocumentAccessEventBody(
      readKeyingCanonicalJson(link.body, "link body"),
    ),
    blobRewraps: [],
  });
  expect((await post("link", tampered)).status).not.toBe(200);
  // The rewrap path is the third site gated by the submission envelope check.
  // Built from the valid rewrap set so it clears the coverage checks and is
  // signed over the malformed material, reaching envelope validation itself.
  const malformedRewrap = await buildDocumentLinkRequest({
    child,
    createdDocument: document,
    owner,
    root,
    blobRewraps: blobRewraps.map((rewrap) => ({
      ...rewrap,
      targets: rewrap.targets.map((rewrapTarget, index) =>
        index === 0 ? { ...rewrapTarget, wrappedKey: "AA==" } : rewrapTarget,
      ),
    })),
  });
  const malformedResponse = await post("link", malformedRewrap);
  const malformedBody = await malformedResponse.text();
  expect({
    status: malformedResponse.status,
    body: malformedBody,
  }).toMatchObject({ status: 400 });
  expect(malformedBody).toContain("wrapped key");
  expect(
    (await getCurrentAccessManifestHead("document", document.id, db))
      ?.manifestHash,
  ).toBe(document.accessManifest.manifestHash);

  const response = await post("link", link);
  const linked = await response.json();
  expect({ status: response.status, body: linked }).toMatchObject({
    status: 200,
  });
  if (!isDocumentLinkSetMutationResponse(linked))
    throw new Error("Expected linked document");
  const wrapsAfterLink = await db
    .select()
    .from(blobContentKeyTargets)
    .where(eq(blobContentKeyTargets.bindingId, target.bindingId));
  expect(
    wrapsAfterLink.some(
      (row) =>
        row.wrappedKey ===
        contentKeyEnvelopeFixture("Blob", "new-child-wrap").wrappedKey,
    ),
  ).toBe(true);
  expect(
    wrapsAfterLink.filter((row) => row.wrappedKey === target.wrappedKey),
  ).toHaveLength(2);
  const unlink = await buildDocumentUnlinkRequest({
    child,
    linkedDocument: linked,
    owner,
    root,
    blobRewraps: [{ blobId, contentKeyEpoch: 1, targets: [target] }],
  });
  const unlinked = await post("unlink", unlink);
  const unlinkedBody = await unlinked.json();
  expect({ status: unlinked.status, body: unlinkedBody }).toMatchObject({
    status: 200,
  });
  if (!isDocumentLinkSetMutationResponse(unlinkedBody))
    throw new Error("Expected unlinked document");
  const wrapsAfterUnlink = await db
    .select()
    .from(blobContentKeyTargets)
    .where(eq(blobContentKeyTargets.bindingId, target.bindingId));
  expect(
    wrapsAfterUnlink.some(
      (row) =>
        row.wrappedKey ===
        contentKeyEnvelopeFixture("Blob", "new-child-wrap").wrappedKey,
    ),
  ).toBe(true);
  expect(
    wrapsAfterUnlink.some((row) => row.wrappedKey === target.wrappedKey),
  ).toBe(true);
  const conflicting = await buildDocumentLinkRequest({
    child,
    createdDocument: { ...document, ...unlinkedBody },
    owner,
    root,
    blobRewraps: blobRewraps.map((rewrap) => ({
      ...rewrap,
      targets: rewrap.targets.map((envelope) =>
        envelope.containerId === target.containerId
          ? {
              ...envelope,
              wrappedKey: contentKeyEnvelopeFixture(
                "Blob",
                "conflicting-active-root-wrap",
              ).wrappedKey,
            }
          : envelope,
      ),
    })),
  });
  const refused = await post("link", conflicting);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({
    error: "Blob content-key bundle conflict",
  });
  expect(
    (await getCurrentAccessManifestHead("document", document.id, db))
      ?.manifestHash,
  ).toBe(unlinkedBody.accessManifest.manifestHash);
  const relink = await buildDocumentLinkRequest({
    child,
    createdDocument: { ...document, ...unlinkedBody },
    owner,
    root,
    blobRewraps: blobRewraps.map((rewrap) => ({
      ...rewrap,
      targets: rewrap.targets.map((envelope) =>
        envelope.containerId === child.containerId
          ? {
              ...envelope,
              wrappedKey: contentKeyEnvelopeFixture("Blob", "fresh-child-wrap")
                .wrappedKey,
            }
          : envelope,
      ),
    })),
  });
  const relinked = await post("link", relink);
  expect({
    status: relinked.status,
    body: await relinked.json(),
  }).toMatchObject({
    status: 200,
  });
  const wrapsAfterRelink = await db
    .select()
    .from(blobContentKeyTargets)
    .where(eq(blobContentKeyTargets.bindingId, target.bindingId));
  expect(
    wrapsAfterRelink.some(
      (row) =>
        row.wrappedKey ===
        contentKeyEnvelopeFixture("Blob", "fresh-child-wrap").wrappedKey,
    ),
  ).toBe(false);
  expect(
    wrapsAfterRelink.some(
      (row) =>
        row.wrappedKey ===
        contentKeyEnvelopeFixture("Blob", "new-child-wrap").wrappedKey,
    ),
  ).toBe(true);
});

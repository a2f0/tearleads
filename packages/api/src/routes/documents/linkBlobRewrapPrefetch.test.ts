import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { accessManifestHeads } from "@tearleads/api-shared/schema";
import { readKeyingCanonicalJson } from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import { and, eq } from "drizzle-orm";
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
import {
  prefetchBlobKekTargets,
  resolveCurrentBlobKekTargets,
} from "../../access/read/blobKekTargets";
import { routeApp } from "../../routeApp";

async function setup() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const childKek = await kekStateFromContainerResponse(child);
  const post = (documentId: string, request: unknown) =>
    routeApp.request(`/documents/${documentId}/link`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  const bindNew = async (
    document: Awaited<ReturnType<typeof createDocument>>,
    slotId: string,
  ) => {
    const blobId = crypto.randomUUID();
    const { request } = await buildBind({
      blobId,
      document,
      owner,
      root,
      slotId,
      stagedBlob: await stageBlob(owner, blobId),
    });
    await bindForTest({ blobId, owner, request });
    const rawTarget = request.contentKeyBundle.targets[0];
    if (!rawTarget) throw new Error("Expected initial blob target");
    const target = {
      ...rawTarget,
      wrappingMetadata: readKeyingCanonicalJson(
        rawTarget.wrappingMetadata,
        "test wrap",
      ),
    };
    const childTarget = {
      ...target,
      containerId: child.containerId,
      containerManifestHash: childKek.accessManifestHash,
      containerKeyEpochId: childKek.containerKeyEpochId,
      containerKeyEpoch: childKek.containerKeyEpoch,
      wrappedKey: contentKeyEnvelopeFixture("Blob", `child-${slotId}`)
        .wrappedKey,
    };
    return { blobId, childTarget, target };
  };
  return { bindNew, child, owner, post, root };
}

test("a link's set-loaded rewraps still fail on the first invalid blob in request order", async () => {
  const { bindNew, child, owner, post, root } = await setup();
  const document = await createDocument({ owner, root });
  const first = await bindNew(document, "first");
  const second = await bindNew(document, "second");
  const link = await buildDocumentLinkRequest({
    child,
    createdDocument: document,
    owner,
    root,
    blobRewraps: [
      // Cites a child KEK epoch the container does not have.
      {
        blobId: first.blobId,
        contentKeyEpoch: 1,
        targets: [first.target, { ...first.childTarget, containerKeyEpoch: 9 }],
      },
      // Cites an epoch the blob never had.
      {
        blobId: second.blobId,
        contentKeyEpoch: 2,
        targets: [second.target, second.childTarget],
      },
    ],
  });
  const refused = await post(document.id, link);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({
    error: "Blob content-key targets do not match current KEK targets",
  });

  const swapped = await buildDocumentLinkRequest({
    child,
    createdDocument: document,
    owner,
    root,
    blobRewraps: [
      {
        blobId: second.blobId,
        contentKeyEpoch: 2,
        targets: [second.target, second.childTarget],
      },
      {
        blobId: first.blobId,
        contentKeyEpoch: 1,
        targets: [first.target, { ...first.childTarget, containerKeyEpoch: 9 }],
      },
    ],
  });
  const refusedFirst = await post(document.id, swapped);
  expect(refusedFirst.status).toBe(409);
  expect(await refusedFirst.json()).toEqual({
    error: "Blob content key epoch changed",
  });
});

test("a container that fails the set-loaded resolution fails only the blobs that reach it", async () => {
  const { bindNew, child, owner, post, root } = await setup();
  const healthyDocument = await createDocument({ owner, root });
  const healthy = await bindNew(healthyDocument, "healthy");
  const linkedDocument = await createDocument({ owner, root });
  const linked = await bindNew(linkedDocument, "linked");
  const link = await buildDocumentLinkRequest({
    child,
    createdDocument: linkedDocument,
    owner,
    root,
    blobRewraps: [
      {
        blobId: linked.blobId,
        contentKeyEpoch: 1,
        targets: [linked.target, linked.childTarget],
      },
    ],
  });
  expect((await post(linkedDocument.id, link)).status).toBe(200);

  const expectedHealthy = await resolveCurrentBlobKekTargets(
    healthy.blobId,
    db,
  );
  // Corrupt the child container's head: it now names the root's manifest.
  await db
    .update(accessManifestHeads)
    .set({ manifestHash: root.bundle.manifestHash })
    .where(
      and(
        eq(accessManifestHeads.objectKind, "container"),
        eq(accessManifestHeads.objectId, child.containerId),
      ),
    );
  const unprefetchedError = await resolveCurrentBlobKekTargets(
    linked.blobId,
    db,
  ).catch((error: unknown) => error);
  expect(unprefetchedError).toBeInstanceOf(Error);

  const prefetch = await prefetchBlobKekTargets(
    [healthy.blobId, linked.blobId],
    db,
  );
  // The union reaches the corrupt child, so no container set is cached.
  expect(prefetch.containerTargetById).toBeNull();
  expect(
    await resolveCurrentBlobKekTargets(healthy.blobId, db, false, prefetch),
  ).toEqual(expectedHealthy);
  const prefetchedError = await resolveCurrentBlobKekTargets(
    linked.blobId,
    db,
    false,
    prefetch,
  ).catch((error: unknown) => error);
  expect(prefetchedError).toEqual(unprefetchedError);

  // A healthy union is cached and resolves exactly as the per-blob reads do.
  const healthyPrefetch = await prefetchBlobKekTargets([healthy.blobId], db);
  expect(healthyPrefetch.containerTargetById).not.toBeNull();
  expect(
    await resolveCurrentBlobKekTargets(
      healthy.blobId,
      db,
      false,
      healthyPrefetch,
    ),
  ).toEqual(expectedHealthy);
});

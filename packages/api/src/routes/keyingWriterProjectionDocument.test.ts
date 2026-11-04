import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestDocumentLinkProjection,
  accessManifests,
  containerKeyEpochs,
  containerKeyWraps,
  documentContentKeyEpochs,
  documentContentKeyTargets,
} from "@tearleads/api-shared/schema";
import type { KeyingCanonicalJson } from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import {
  DOCUMENT_PROJECTION_ERROR_CODES,
  type DocumentWriterProjectionResponse,
  isDocumentLinkSetMutationResponse,
  isDocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../test/helpers/authenticate";
import { buildDocumentLinkRequest } from "../../test/helpers/documentLinkMutation";
import { createChildContainer } from "../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  createDocument,
  kekStateFromContainerResponse,
} from "../../test/helpers/keyingWriterProjectionKit";
import { moveContainer } from "../../test/helpers/keyingWriterProjectionMove";
import { registerUser } from "../../test/helpers/registerUser";
import { decodeServedDocumentProjection } from "../../test/helpers/servedWriterProjection";
import { routeApp } from "../routeApp";

test("GET /documents/:documentId/writer-projection returns document targets and authorizing paths", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(200);
  const projection = decodeServedDocumentProjection(
    await projectionResponse.json(),
  );
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);
  expect(projection.documentId).toBe(created.id);
  expect(projection.documentManifest.manifestHash).toBe(created.manifestHash);
  expect(projection.documentManifest.event.eventHash).toBe(
    Reflect.get(created.accessManifest.event, "eventHash"),
  );
  expect(projection.documentManifest.event.body).toMatchObject({
    eventType: "document.link",
  });
  expect(projection.documentKekTargets.documentKeyTargetHash).toBe(
    created.targetHash,
  );
  expect(projection.contentKeyBundle.targetHash).toBe(created.targetHash);
  expect(projection.authorizingContainerPaths).toHaveLength(1);
});

test("GET /documents/:documentId/writer-projection emits the coded document_not_found 404 for an unknown document", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const response = await routeApp.request(
    `/documents/${crypto.randomUUID()}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    code: "document_not_found",
    error: "Document not found",
  });
});

test("GET /documents/:documentId/writer-projection rejects tampered content-key targets", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const [contentKeyEpoch] = await db
    .select({ id: documentContentKeyEpochs.id })
    .from(documentContentKeyEpochs)
    .where(eq(documentContentKeyEpochs.documentId, created.id))
    .limit(1);
  invariant(contentKeyEpoch, "expected document content-key epoch");

  await db
    .update(documentContentKeyTargets)
    .set({
      containerKeyEpochId: "tampered-container-key-epoch",
    })
    .where(
      eq(
        documentContentKeyTargets.documentContentKeyEpochId,
        contentKeyEpoch.id,
      ),
    );

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(409);
});

test("GET /documents/:documentId/writer-projection rejects stale document KEK targets", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  await db.insert(accessManifestDocumentLinkProjection).values({
    containerId: crypto.randomUUID(),
    documentId: created.id,
    manifestHash: created.manifestHash,
  });

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(409);
  expect(await projectionResponse.json()).toEqual({
    code: "document_projection_kek_targets_unavailable",
    error: "Container manifest head missing",
  });
});

test("GET /documents/:documentId/writer-projection rejects malformed stored document state", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  await db
    .update(accessManifests)
    .set({
      state: {
        ...created.accessManifest.state,
        linkedContainerIds: "not-linked-container-ids",
      } as KeyingCanonicalJson,
    })
    .where(eq(accessManifests.manifestHash, created.manifestHash));

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(409);
});

test("GET /documents/:documentId/writer-projection returns multi-linked container paths", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  const linkResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await buildDocumentLinkRequest({
          child,
          createdDocument,
          owner,
          root,
        }),
      ),
    },
  );
  expect(linkResponse.status).toBe(200);
  const linked = await linkResponse.json();
  expect(isDocumentLinkSetMutationResponse(linked)).toBe(true);

  const projectionResponse = await routeApp.request(
    `/documents/${createdDocument.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(200);
  const projection = decodeServedDocumentProjection(
    await projectionResponse.json(),
  );
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);
  const writerProjection = projection as DocumentWriterProjectionResponse;
  expect(
    writerProjection.documentManifestHistory?.map(
      (bundle) => bundle.manifestHash,
    ),
  ).toEqual([createdDocument.manifestHash]);
  expect(
    new Map(
      writerProjection.documentManifestContainerPaths?.map((path) => [
        path.at(-1)?.manifestHash,
        path.map((bundle) => bundle.manifestHash),
      ]),
    ),
  ).toEqual(
    new Map([
      [root.bundle.manifestHash, [root.bundle.manifestHash]],
      [
        child.accessManifest.manifestHash,
        [root.bundle.manifestHash, child.accessManifest.manifestHash],
      ],
    ]),
  );
  expect(writerProjection.documentKekTargets.targets).toHaveLength(2);
  const pathsByContainerId = new Map(
    writerProjection.authorizingContainerPaths.map((path) => [
      path.containerId,
      path.path.map((entry) => entry.manifestHash),
    ]),
  );
  expect(pathsByContainerId).toEqual(
    new Map([
      [root.kekState.containerId, [root.bundle.manifestHash]],
      [
        child.containerId,
        [root.bundle.manifestHash, child.accessManifest.manifestHash],
      ],
    ]),
  );

  const destinationParent = await createChildContainer({
    parent: root,
    signer: owner,
  });
  const movedChild = await moveContainer({
    destinationParent:
      await accessManifestFromContainerResponse(destinationParent),
    destinationParentKekState:
      await kekStateFromContainerResponse(destinationParent),
    destinationParentPath: [
      root.bundle,
      await accessManifestFromContainerResponse(destinationParent),
    ],
    previous: await accessManifestFromContainerResponse(child),
    previousContainerPath: [
      root.bundle,
      await accessManifestFromContainerResponse(child),
    ],
    previousKekState: await kekStateFromContainerResponse(child),
    signer: owner,
  });
  const movedChildKekId = (await kekStateFromContainerResponse(movedChild))
    .containerKeyEpochId;
  const [storedMovedChildEpoch] = await db
    .select({
      wrappedPredecessorKey: containerKeyEpochs.wrappedPredecessorKey,
    })
    .from(containerKeyEpochs)
    .where(eq(containerKeyEpochs.id, movedChildKekId));
  if (!storedMovedChildEpoch?.wrappedPredecessorKey) {
    throw new Error("Expected moved child predecessor bridge");
  }
  await db
    .update(containerKeyEpochs)
    .set({ wrappedPredecessorKey: "not-base64" })
    .where(eq(containerKeyEpochs.id, movedChildKekId));

  const healthyPathResponse = await routeApp.request(
    `/documents/${createdDocument.id}/writer-projection`,
    {
      headers: { Authorization: `Bearer ${owner.token}` },
    },
  );
  expect(healthyPathResponse.status).toBe(200);
  const healthyPathProjection = decodeServedDocumentProjection(
    await healthyPathResponse.json(),
  );
  expect(
    healthyPathProjection?.authorizingContainerPaths
      .map((path) => path.containerId)
      .sort(),
  ).toEqual([root.kekState.containerId, child.containerId].sort());

  await db
    .update(containerKeyEpochs)
    .set({
      wrappedPredecessorKey: storedMovedChildEpoch.wrappedPredecessorKey,
    })
    .where(eq(containerKeyEpochs.id, movedChildKekId));

  await db
    .update(containerKeyWraps)
    .set({ recipientKeyFingerprint: "corrupt-fingerprint" })
    .where(eq(containerKeyWraps.containerKeyEpochId, movedChildKekId));

  const noHealthyPathResponse = await routeApp.request(
    `/documents/${createdDocument.id}/writer-projection`,
    {
      headers: { Authorization: `Bearer ${owner.token}` },
    },
  );
  expect(noHealthyPathResponse.status).toBe(409);
  await expect(noHealthyPathResponse.json()).resolves.toEqual({
    code: DOCUMENT_PROJECTION_ERROR_CODES.containerConflict,
    error:
      "container key wrap.recipientKeyFingerprint must be a 64-character lowercase hex hash",
  });
});

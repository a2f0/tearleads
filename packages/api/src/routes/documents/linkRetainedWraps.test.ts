import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  blobContentKeyTargets,
  documentContentKeyEpochs,
  documentContentKeyTargets,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { eq } from "drizzle-orm";
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
import { routeApp } from "../../routeApp";

// Greenfield writes validate every submitted envelope, including retained ones.
test("a retained blob wrap with extra metadata is rejected on relink", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const document = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const { request: bind } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob: await stageBlob(owner, blobId),
  });
  await bindForTest({ blobId, owner, request: bind });

  const rawTarget = bind.contentKeyBundle.targets[0];
  if (!rawTarget) throw new Error("Expected an initial blob target");
  const wrappingMetadata = {
    ...rawTarget.wrappingMetadata,
    unrecognized: "injected stored field",
  };
  await db
    .update(blobContentKeyTargets)
    .set({ wrappingMetadata })
    .where(eq(blobContentKeyTargets.bindingId, rawTarget.bindingId));

  // Exactly what a client reads back and hands to the link mutation.
  const retained = { ...rawTarget, wrappingMetadata };
  const childKek = kekStateFromContainerResponse(child);
  const link = await buildDocumentLinkRequest({
    child,
    createdDocument: document,
    owner,
    root,
    blobRewraps: [
      {
        blobId,
        contentKeyEpoch: 1,
        targets: [
          retained,
          {
            ...retained,
            containerId: child.containerId,
            containerManifestHash: childKek.accessManifestHash,
            containerKeyEpochId: childKek.containerKeyEpochId,
            containerKeyEpoch: childKek.containerKeyEpoch,
            ...contentKeyEnvelopeFixture("Blob", "retained-child-wrap"),
          },
        ],
      },
    ],
  });
  const response = await routeApp.request(`/documents/${document.id}/link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(link),
  });
  const body = await response.text();
  expect({ status: response.status, body }).toMatchObject({ status: 400 });

  const rows = await db
    .select()
    .from(blobContentKeyTargets)
    .where(eq(blobContentKeyTargets.bindingId, rawTarget.bindingId));
  expect(
    rows.filter(
      (row) =>
        isPlainObject(row.wrappingMetadata) &&
        Reflect.get(row.wrappingMetadata, "unrecognized") ===
          "injected stored field",
    ),
  ).not.toHaveLength(0);
});

test("a retained document wrap with extra metadata is rejected on relink", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const document = await createDocument({ owner, root });

  const retainedTarget = document.contentKeyBundle.targets[0];
  if (!retainedTarget) throw new Error("Expected a stored document target");
  const wrappingMetadata = {
    ...retainedTarget.wrappingMetadata,
    unrecognized: "injected stored field",
  };
  const [epoch] = await db
    .select({ id: documentContentKeyEpochs.id })
    .from(documentContentKeyEpochs)
    .where(eq(documentContentKeyEpochs.documentId, document.id));
  if (!epoch) throw new Error("Expected a stored content-key epoch");
  await db
    .update(documentContentKeyTargets)
    .set({ wrappingMetadata })
    .where(eq(documentContentKeyTargets.documentContentKeyEpochId, epoch.id));

  const link = await buildDocumentLinkRequest({
    child,
    // Exactly what the writer projection hands the client back.
    createdDocument: {
      ...document,
      contentKeyBundle: {
        ...document.contentKeyBundle,
        targets: document.contentKeyBundle.targets.map((target) =>
          target.containerId === retainedTarget.containerId
            ? { ...target, wrappingMetadata }
            : target,
        ),
      },
    },
    owner,
    root,
  });
  const post = (request: unknown) =>
    routeApp.request(`/documents/${document.id}/link`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

  const response = await post(link);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid request" });
});

test("a shared bind rejects extra metadata in another document's retained wrap", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
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

  const firstTarget = initial.request.contentKeyBundle.targets[0];
  if (!firstTarget) throw new Error("Expected the first document's target");
  const wrappingMetadata = {
    ...firstTarget.wrappingMetadata,
    unrecognized: "injected stored field",
  };
  await db
    .update(blobContentKeyTargets)
    .set({ wrappingMetadata })
    .where(eq(blobContentKeyTargets.documentId, first.id));

  const shared = await buildBind({
    activeBindings: [initial.binding],
    blobId,
    document: second,
    documents: [first, second],
    owner,
    root,
  });
  const retainingBind = (
    mapTarget: (
      target: (typeof shared.request.contentKeyBundle.targets)[number],
    ) => (typeof shared.request.contentKeyBundle.targets)[number],
  ) => ({
    ...shared.request,
    contentKeyBundle: {
      ...shared.request.contentKeyBundle,
      targets: shared.request.contentKeyBundle.targets.map((target) =>
        target.documentId === first.id
          ? { ...target, wrappingMetadata }
          : mapTarget(target),
      ),
    },
  });

  await expect(
    bindForTest({ blobId, owner, request: retainingBind((target) => target) }),
  ).rejects.toThrow(
    "Blob content-key target metadata must contain exactly suite and iv",
  );

  const rows = await db
    .select()
    .from(blobContentKeyTargets)
    .where(eq(blobContentKeyTargets.documentId, first.id));
  expect(
    rows.filter(
      (row) =>
        isPlainObject(row.wrappingMetadata) &&
        Reflect.get(row.wrappingMetadata, "unrecognized") ===
          "injected stored field",
    ),
  ).not.toHaveLength(0);
});

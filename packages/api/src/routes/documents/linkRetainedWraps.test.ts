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

// A relink resubmits a retained wrap verbatim. Holding that stored envelope to
// the submission shape would make a row carrying an unrecognized metadata key
// permanently un-linkable, with no client-side heal: the API refuses to
// replace an active target's wrap, so the row can never be rewritten.
test("a retained wrap with an unrecognized metadata key can still be relinked", async () => {
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
    stagedBlob: await stageBlob(owner),
  });
  await bindForTest({ blobId, owner, request: bind });

  const rawTarget = bind.contentKeyBundle.targets[0];
  if (!rawTarget) throw new Error("Expected an initial blob target");
  const wrappingMetadata = {
    ...rawTarget.wrappingMetadata,
    unrecognized: "written by a newer build",
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
  expect({ status: response.status, body }).toMatchObject({ status: 200 });

  const rows = await db
    .select()
    .from(blobContentKeyTargets)
    .where(eq(blobContentKeyTargets.bindingId, rawTarget.bindingId));
  expect(
    rows.filter(
      (row) =>
        isPlainObject(row.wrappingMetadata) &&
        Reflect.get(row.wrappingMetadata, "unrecognized") ===
          "written by a newer build",
    ),
  ).not.toHaveLength(0);
});

// The document link path has the same shape: `linkSet.ts` carries the stored
// bundle's targets verbatim and appends one freshly wrapped target, so the
// submitted set mixes stored and new material. There is no heal here either —
// a retained target must be resubmitted byte-identical or the bundle is stale.
test("a retained document wrap with an unrecognized metadata key can still be relinked", async () => {
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
    unrecognized: "written by a newer build",
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

  // The newly appended target is the half the filter must still gate. The
  // target hash covers neither the wrapped key nor its metadata, so this
  // reaches envelope validation rather than a hash mismatch.
  const malformed = structuredClone(link);
  const appended = malformed.contentKeyBundle.targets.find(
    (target) => target.containerId === child.containerId,
  );
  if (!appended) throw new Error("Expected the appended child target");
  Reflect.set(appended, "wrappedKey", "AA==");
  const refused = await post(malformed);
  const refusedBody = await refused.text();
  expect({ status: refused.status, body: refusedBody }).toMatchObject({
    status: 400,
  });
  expect(refusedBody).toContain(
    "Document content-key target wrapped key has an invalid encoded length",
  );

  const response = await post(link);
  const body = await response.text();
  expect({ status: response.status, body }).toMatchObject({ status: 200 });
});

// A blob bind covers every active binding of that blob, so binding a blob a
// second document already holds resubmits the first document's stored wraps.
// That is the third write path where stored and fresh material arrive
// together, and the one a first bind does not exercise.
test("a shared bind carrying another document's stored wrap is accepted", async () => {
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
    stagedBlob: await stageBlob(owner),
  });
  await bindForTest({ blobId, owner, request: initial.request });

  const firstTarget = initial.request.contentKeyBundle.targets[0];
  if (!firstTarget) throw new Error("Expected the first document's target");
  const wrappingMetadata = {
    ...firstTarget.wrappingMetadata,
    unrecognized: "written by a newer build",
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

  // The second document's target is the newly wrapped half, and it is still
  // gated: the exemption covers stored bytes, not everything in the set.
  await expect(
    bindForTest({
      blobId,
      owner,
      request: retainingBind((target) => ({ ...target, wrappedKey: "AA==" })),
    }),
  ).rejects.toThrow(
    "Blob content-key target wrapped key has an invalid encoded length",
  );

  await bindForTest({
    blobId,
    owner,
    request: retainingBind((target) => target),
  });

  const rows = await db
    .select()
    .from(blobContentKeyTargets)
    .where(eq(blobContentKeyTargets.documentId, first.id));
  expect(
    rows.filter(
      (row) =>
        isPlainObject(row.wrappingMetadata) &&
        Reflect.get(row.wrappingMetadata, "unrecognized") ===
          "written by a newer build",
    ),
  ).not.toHaveLength(0);
});

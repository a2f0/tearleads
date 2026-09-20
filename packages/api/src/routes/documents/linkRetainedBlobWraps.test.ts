import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { blobContentKeyTargets } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
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
    rows.filter((row) =>
      JSON.stringify(row.wrappingMetadata).includes("unrecognized"),
    ),
  ).not.toHaveLength(0);
});

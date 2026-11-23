import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import {
  emptyVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import { createTestUser } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  DOCUMENT_MUTATION_ERROR_CODES,
  DOCUMENT_SYNC_ERROR_CODES,
  isDocumentLinkSetMutationResponse,
  isDocumentSyncResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { withDocumentMutationArtifacts } from "../../../test/helpers/documentAcknowledgementFixture";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../../test/helpers/documentLinkMutation";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { routeApp } from "../../routeApp";

/** Claims another peer's operations, which no version can hold. */
const overclaimedSpan = {
  partialEndVersionVector: encodeVersionVectorCounters({ "4242": 7 }),
  partialStartVersionVector: emptyVersionVector(),
};

async function documentWithOverclaim() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const overclaim = await createSignedDocumentSyncRequest({
    created,
    declaredSpan: overclaimedSpan,
    owner,
    root,
  });
  expect(
    (await postDocumentSync(owner, created.id, overclaim.request)).status,
  ).toBe(200);
  return { created, overclaimId: overclaim.updateId, owner, root };
}

async function postJson(token: string, path: string, body: unknown) {
  return routeApp.request(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// A baseline's author imported or voided every update up to its signed
// cursor, so the gates weigh only later updates. Before the cursor, one
// overclaimed span refused every rotation and unlink of the document.
test("POST /documents/:documentId/sync weighs a checkpoint after its signed cursor", async () => {
  const { created, overclaimId, owner, root } = await documentWithOverclaim();
  const checkpoint = (coversThroughUpdateId?: string) =>
    createSignedDocumentSyncRequest({
      checkpoint: true,
      coversThroughUpdateId,
      created,
      owner,
      root,
    });

  for (const cursor of [undefined, crypto.randomUUID()]) {
    const refused = await postDocumentSync(
      owner,
      created.id,
      (await checkpoint(cursor)).request,
    );
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe(
      DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
    );
  }
  const covering = await checkpoint(overclaimId);
  const accepted = await postDocumentSync(owner, created.id, covering.request);
  expect(accepted.status).toBe(200);
  const [stored] = await db
    .select({ cursor: documentUpdates.baselineCoversThroughUpdateId })
    .from(documentUpdates)
    .where(eq(documentUpdates.id, covering.updateId));
  expect(stored?.cursor).toBe(overclaimId);

  // An update committed after the cursor is still weighed.
  const honest = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  expect(
    (await postDocumentSync(owner, created.id, honest.request)).status,
  ).toBe(200);
  expect(
    (
      await postDocumentSync(
        owner,
        created.id,
        (
          await checkpoint(overclaimId)
        ).request,
      )
    ).status,
  ).toBe(409);
});

test("POST /documents/:documentId/unlink weighs updates after the baseline cursor and the redirect follows it", async () => {
  const { created, overclaimId, owner, root } = await documentWithOverclaim();
  const honest = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  expect(
    (await postDocumentSync(owner, created.id, honest.request)).status,
  ).toBe(200);
  const honestEnd = honest.request.outgoingUpdates[0]?.partialEndVersionVector;
  if (!honestEnd) throw new Error("Expected the honest update");
  const child = await createChildContainer({ parent: root, signer: owner });
  const linkRequest = await buildDocumentLinkRequest({
    child,
    createdDocument: created,
    owner,
    root,
  });
  const linkResponse = await postJson(
    owner.token,
    `/documents/${created.id}/link`,
    linkRequest,
  );
  expect(linkResponse.status).toBe(200);
  const linkedDocument = withDocumentMutationArtifacts(
    linkRequest,
    await linkResponse.json(),
  );
  expect(isDocumentLinkSetMutationResponse(linkedDocument)).toBe(true);
  const unlink = (input: {
    readonly cursor?: string;
    readonly source: string;
  }) =>
    buildDocumentUnlinkRequest({
      child,
      linkedDocument,
      owner,
      root,
      rotationBaselineCoversThroughUpdateId: input.cursor,
      rotationBaselineSourceVersionVector: input.source,
    });

  // Without a cursor the overclaim is weighed; with one, the honest update
  // after it still is.
  for (const refused of [
    { source: honestEnd },
    {
      cursor: overclaimId,
      source: encodeVersionVectorCounters({ "4243": 1 }),
    },
  ]) {
    const response = await postJson(
      owner.token,
      `/documents/${created.id}/unlink`,
      await unlink(refused),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe(
      DOCUMENT_MUTATION_ERROR_CODES.unlinkRotationBaselineStale,
    );
  }
  const unlinkRequest = await unlink({
    cursor: overclaimId,
    source: honestEnd,
  });
  const unlinkResponse = await postJson(
    owner.token,
    `/documents/${created.id}/unlink`,
    unlinkRequest,
  );
  expect(unlinkResponse.status).toBe(200);
  const unlinked = await unlinkResponse.json();
  expect(isDocumentLinkSetMutationResponse(unlinked)).toBe(true);
  const baselineId = unlinkRequest.rotationBaseline?.id;
  if (!baselineId) throw new Error("Expected a rotation baseline");

  const pull = () =>
    postDocumentSync(owner, created.id, {
      contentKeyEpoch: unlinked.contentKeyEpoch,
      expectedLinkSetManifestHash: unlinked.manifestHash,
      expectedTargetHash: unlinked.targetHash,
      localVersionVector: null,
      outgoingUpdates: [],
      supportsPullPagination: true,
    } satisfies DocumentSyncRequest);
  // The overclaim is at or before the baseline's cursor, so a new reader
  // starts at the baseline.
  const pulled = await pull();
  expect(pulled.status).toBe(200);
  const synced = await pulled.json();
  expect(isDocumentSyncResponse(synced)).toBe(true);
  expect(synced.updates.map((update: { id: string }) => update.id)).toEqual([
    baselineId,
  ]);

  // A stored cursor that is not the signed one fails the baseline's
  // integrity check, so the pull fails closed rather than skip history.
  await db
    .update(documentUpdates)
    .set({ baselineCoversThroughUpdateId: honest.updateId })
    .where(eq(documentUpdates.id, baselineId));
  const tampered = await pull();
  expect(tampered.status).toBe(409);
  expect((await tampered.json()).error).toBe(
    "Document rotation checkpoint failed integrity validation",
  );
});

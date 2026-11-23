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
import {
  createSignedAtomicRotationBaseline,
  createSignedDocumentSyncRequest,
} from "../../../test/helpers/documentUpdateRequests";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  asVerifiedContainerManifest,
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

type Owner = Awaited<ReturnType<typeof documentWithOverclaim>>["owner"];
type Root = Awaited<ReturnType<typeof documentWithOverclaim>>["root"];
type Created = Awaited<ReturnType<typeof documentWithOverclaim>>["created"];

/** Links the document into a child folder; returns its unlink builder. */
async function linkedForUnlink(input: {
  readonly created: Created;
  readonly owner: Owner;
  readonly root: Root;
}) {
  const { created, owner, root } = input;
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
  return (unlink: { readonly cursor?: string; readonly source: string }) =>
    buildDocumentUnlinkRequest({
      child,
      linkedDocument,
      owner,
      root,
      rotationBaselineCoversThroughUpdateId: unlink.cursor,
      rotationBaselineSourceVersionVector: unlink.source,
    });
}

/** A first pull by a reader that holds nothing. */
function pullAsNewReader(
  owner: Owner,
  documentId: string,
  unlinked: {
    readonly contentKeyEpoch: number;
    readonly manifestHash: string;
    readonly targetHash: string;
  },
) {
  return postDocumentSync(owner, documentId, {
    contentKeyEpoch: unlinked.contentKeyEpoch,
    expectedLinkSetManifestHash: unlinked.manifestHash,
    expectedTargetHash: unlinked.targetHash,
    localVersionVector: null,
    outgoingUpdates: [],
    supportsPullPagination: true,
  } satisfies DocumentSyncRequest);
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
  const unlink = await linkedForUnlink({ created, owner, root });

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

  const pull = () => pullAsNewReader(owner, created.id, unlinked);
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

// A reader that voided every update holds an empty document, whose snapshot
// declares no operation. Its baseline signs the cursor alone, and the API
// weighs only the updates after it. Before #3194 the client sent no
// baseline, and the API refused the unlink while any update was committed.
test("POST /documents/:documentId/unlink takes an empty baseline that signs its cursor", async () => {
  const { created, overclaimId, owner, root } = await documentWithOverclaim();
  const unlink = await linkedForUnlink({ created, owner, root });
  const empty = emptyVersionVector();

  // Without the cursor, the empty baseline does not cover the overclaim.
  const uncovered = await postJson(
    owner.token,
    `/documents/${created.id}/unlink`,
    await unlink({ source: empty }),
  );
  expect(uncovered.status).toBe(409);
  expect((await uncovered.json()).code).toBe(
    DOCUMENT_MUTATION_ERROR_CODES.unlinkRotationBaselineStale,
  );
  const unlinkRequest = await unlink({ cursor: overclaimId, source: empty });
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

  // A new reader starts at the empty baseline and never meets the overclaim.
  // The baseline carries no operation, so it is not served either, and the
  // pull's cursor still reaches it.
  const pulled = await pullAsNewReader(owner, created.id, unlinked);
  expect(pulled.status).toBe(200);
  const synced = await pulled.json();
  expect(isDocumentSyncResponse(synced)).toBe(true);
  expect(synced.updates).toEqual([]);
  expect(synced.pullPage?.throughUpdateId).toBe(baselineId);
});

// The sync gates weigh a checkpoint the same way: an empty one that signs
// its cursor covers an all-void log, and one without a cursor does not.
test("POST /documents/:documentId/sync takes an empty checkpoint that signs its cursor", async () => {
  const { created, overclaimId, owner, root } = await documentWithOverclaim();
  const emptyCheckpoint = (coversThroughUpdateId?: string) =>
    createSignedDocumentSyncRequest({
      checkpoint: true,
      coversThroughUpdateId,
      created,
      declaredSpan: {
        partialEndVersionVector: emptyVersionVector(),
        partialStartVersionVector: emptyVersionVector(),
      },
      owner,
      root,
    });

  const uncovered = await postDocumentSync(
    owner,
    created.id,
    (await emptyCheckpoint()).request,
  );
  expect(uncovered.status).toBe(409);
  expect((await uncovered.json()).code).toBe(
    DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
  );
  expect(
    (
      await postDocumentSync(
        owner,
        created.id,
        (
          await emptyCheckpoint(overclaimId)
        ).request,
      )
    ).status,
  ).toBe(200);
});

// No honest client sends an empty baseline without a cursor: a document never
// written has nothing to rotate, so its unlink carries no baseline at all.
test("POST /documents/:documentId/unlink refuses an empty baseline without a cursor", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const unlink = await linkedForUnlink({ created, owner, root });
  const request = await unlink({ source: emptyVersionVector() });
  expect(request.rotationBaseline).toBeUndefined();

  // A modified client sends the empty baseline the SDK omits.
  const refused = await postJson(
    owner.token,
    `/documents/${created.id}/unlink`,
    {
      ...request,
      rotationBaseline: await createSignedAtomicRotationBaseline({
        accessManifestHash: request.contentKeyBundle.linkSetManifestHash,
        contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch,
        dependencyManifestHashes: (
          request.authorizingContainerPathRefs[0] ?? []
        ).map((ref) => ref.manifestHash),
        documentId: created.id,
        organizationId: asVerifiedContainerManifest(root.bundle).state
          .organizationId,
        owner,
        sourceVersionVector: emptyVersionVector(),
        targetHash: request.contentKeyBundle.targetHash,
      }),
    },
  );
  expect(refused.status).toBe(400);
  expect((await refused.json()).error).toBe(
    "Document update declares no operations",
  );
});

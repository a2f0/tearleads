import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  type DocumentSyncResponse,
  isDocumentLinkSetMutationResponse,
} from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  type CreatedDocumentFixture,
  withDocumentMutationArtifacts,
} from "../../../test/helpers/documentAcknowledgementFixture";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../../test/helpers/documentLinkMutation";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
  type StoredRootFixture,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { routeApp } from "../../routeApp";

interface Fixture {
  readonly created: CreatedDocumentFixture;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}

async function commit(fixture: Fixture): Promise<{ id: string; end: string }> {
  const { request, updateId } = await createSignedDocumentSyncRequest(fixture);
  const response = await postDocumentSync(
    fixture.owner,
    fixture.created.id,
    request,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const [update] = request.outgoingUpdates;
  if (!update) throw new Error("Expected one update");
  return { id: updateId, end: update.partialEndVersionVector };
}

async function postJson(owner: TestUser, path: string, body: unknown) {
  const response = await routeApp.request(path, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json();
}

/**
 * A document with two committed updates, then linked to a child container
 * and unlinked again, which rotates its content key and commits a rotation
 * baseline covering both.
 */
async function rotatedDocument() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const created = await createDocument({ owner, root });
  const fixture = { created, owner, root };
  const judged = await commit(fixture);
  const missed = await commit(fixture);

  const linkRequest = await buildDocumentLinkRequest({
    child,
    createdDocument: created,
    owner,
    root,
  });
  const linkedDocument = withDocumentMutationArtifacts(
    linkRequest,
    await postJson(owner, `/documents/${created.id}/link`, linkRequest),
  );
  const unlinkRequest = await buildDocumentUnlinkRequest({
    child,
    linkedDocument,
    owner,
    root,
  });
  const rotated = await postJson(
    owner,
    `/documents/${created.id}/unlink`,
    unlinkRequest,
  );
  expect(isDocumentLinkSetMutationResponse(rotated)).toBe(true);
  const baselineId = unlinkRequest.rotationBaseline?.id;
  if (baselineId === undefined) throw new Error("Expected a baseline");
  return { baselineId, created, judged, missed, owner, rotated };
}

async function pull(
  document: Awaited<ReturnType<typeof rotatedDocument>>,
  input: {
    readonly localVersionVector: string;
    readonly processedThroughUpdateId?: string;
  },
): Promise<DocumentSyncResponse> {
  const request: DocumentSyncRequest = {
    contentKeyEpoch: document.rotated.contentKeyEpoch,
    expectedLinkSetManifestHash: document.rotated.manifestHash,
    expectedTargetHash: document.rotated.targetHash,
    localVersionVector: input.localVersionVector,
    outgoingUpdates: [],
    ...(input.processedThroughUpdateId === undefined
      ? {}
      : { processedThroughUpdateId: input.processedThroughUpdateId }),
    supportsPullPagination: true,
  };
  return (await postJson(
    document.owner,
    `/documents/${document.created.id}/sync`,
    request,
  )) as DocumentSyncResponse;
}

test("a first page after a processed cursor still goes straight to the rotation baseline", async () => {
  const document = await rotatedDocument();

  // Without a cursor, the redirect skips the old-epoch update the baseline
  // covers.
  const byVersion = await pull(document, {
    localVersionVector: document.judged.end,
  });
  expect(byVersion.updates.map(({ id }) => id)).toEqual([document.baselineId]);

  // A cursor moves the page's start past what the reader judged; the
  // baseline still serves in place of the old-epoch update after it.
  const afterCursor = await pull(document, {
    localVersionVector: document.judged.end,
    processedThroughUpdateId: document.judged.id,
  });
  expect(afterCursor.updates.map(({ id }) => id)).toEqual([
    document.baselineId,
  ]);
  expect(afterCursor.updates.map(({ id }) => id)).not.toContain(
    document.missed.id,
  );
  expect(afterCursor.contentKeyBundles).toEqual([]);

  // A cursor at the baseline or past it has nothing before it to skip.
  const pastBaseline = await pull(document, {
    localVersionVector: document.judged.end,
    processedThroughUpdateId: document.baselineId,
  });
  expect(pastBaseline.updates).toEqual([]);
});

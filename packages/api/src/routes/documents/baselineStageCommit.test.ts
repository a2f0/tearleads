// A staged rotation baseline is committed by the request that rotates: the
// unlink or sync carries the final segment and names the stage, and the
// staged segments become the document's updates ahead of it, in one
// transaction, with their ciphertext left where it was staged.
//
// This file runs on the memory database with every other suite, and again
// in the Postgres concurrency lane (`testPostgresConcurrency.sh`), since the
// commit's set-based statements and its sequence order are claims about
// Postgres itself. It keeps the plain `.test.ts` name for that reason: a
// `.pg.test.ts` file is one whose tests run only there.
import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documents, documentUpdates } from "@tearleads/api-shared/schema";
import { mergeVersionVectors, versionVectorsEqual } from "@tearleads/loro";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  type DocumentSyncResponse,
  isDocumentLinkSetMutationResponse,
} from "@tearleads/validators/response";
import { MAX_DOCUMENT_BASELINE_SEGMENTS } from "@tearleads/validators/util";
import { asc, eq } from "drizzle-orm";
import { signerFor } from "../../../test/helpers/baselineGroupRefusals";
import {
  documentWithHistory,
  groupFields,
  type History,
  linkedForUnlink,
  postJson,
  pullAsNewReader,
  storedUpdates,
} from "../../../test/helpers/baselineGroupRouteKit";
import {
  stageAllButFinal,
  stagedRows,
} from "../../../test/helpers/baselineStageKit";
import { baselineSegmentRanges } from "../../../test/helpers/documentBaselineGroups";
import { peerSpan } from "../../../test/helpers/documentPeerOwnership";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";

function currentSigner(history: History) {
  const { created, root } = history;
  return signerFor(history, {
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch,
    dependencyManifestHashes: [root.bundle.manifestHash],
    targetHash: created.targetHash,
  });
}

/** Where each of a document's updates keeps its ciphertext. */
async function storedPayloads(documentId: string) {
  const rows = await db
    .select({
      encryptedData: documentUpdates.encryptedData,
      id: documentUpdates.id,
    })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, documentId))
    .orderBy(asc(documentUpdates.sequence));
  return new Map(rows.map((row) => [row.id, row.encryptedData]));
}

async function updateCount(documentId: string): Promise<number> {
  const [row] = await db
    .select({ updateCount: documents.updateCount })
    .from(documents)
    .where(eq(documents.id, documentId));
  return row?.updateCount ?? Number.NaN;
}

test("an unlink commits a staged baseline by reference, and a new reader pages through it", async () => {
  const history = await documentWithHistory();
  const { committed, created, frontier, owner } = history;
  const unlink = await linkedForUnlink(history);
  const request = await unlink({ rotationBaselineSegments: 3 });
  const group = request.rotationBaseline ?? [];
  expect(group).toHaveLength(3);
  const { baselineStageId, final, staged } = await stageAllButFinal(
    owner,
    created.id,
    group,
    { contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch },
  );
  expect(await storedUpdates(created.id)).toHaveLength(committed.length);

  const response = await postJson(owner, `/documents/${created.id}/unlink`, {
    ...request,
    baselineStageId,
    rotationBaseline: [final],
  });
  expect(response.status).toBe(200);
  const unlinked = await response.json();
  expect(isDocumentLinkSetMutationResponse(unlinked)).toBe(true);

  // The staged segments are update rows now, after the history they carry
  // and ahead of the final segment, in index order.
  const stored = (await storedUpdates(created.id)).slice(committed.length);
  expect(stored.map((row) => [row.id, row.baselineSegmentIndex])).toEqual(
    group.map((segment, index) => [segment.id, index]),
  );
  expect(stored.map((row) => row.baselineSegmentCount)).toEqual([
    null,
    null,
    3,
  ]);
  const sequences = stored.map((row) => row.sequence);
  expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
  expect(new Set(sequences).size).toBe(3);
  // The count the insert trigger keeps saw the staged rows.
  expect(await updateCount(created.id)).toBe(committed.length + 3);

  // Their ciphertext was not copied: the update rows hold none, and the
  // staged rows that do are all that is left of the stage.
  const payloads = await storedPayloads(created.id);
  expect(staged.map((segment) => payloads.get(segment.id))).toEqual([
    null,
    null,
  ]);
  expect(payloads.get(final.id)).toBe(final.encryptedData);
  expect(await stagedRows(created.id)).toEqual({
    segments: staged.map((segment, index) => ({
      baselineId: baselineStageId,
      segmentIndex: index,
      updateId: segment.id,
    })),
    spans: [],
    stages: [],
  });

  // A reader that holds nothing pages through the group: every segment
  // once, in order, with its own ciphertext and the fields its writer
  // signed, and no update of the rotated-away epoch.
  const pages = await pullAsNewReader(owner, created.id, unlinked, 2);
  expect(pages.map((page) => page.updates.length)).toEqual([2, 1]);
  const served = pages.flatMap((page) => page.updates);
  expect(served.map(groupFields)).toEqual(group.map(groupFields));
  expect(served.map((update) => update.encryptedData)).toEqual(
    group.map((segment) => segment.encryptedData),
  );
  expect(
    versionVectorsEqual(
      mergeVersionVectors(
        served.map((update) => update.partialEndVersionVector),
      ),
      frontier,
    ),
  ).toBe(true);
});

test("a sync commits a staged baseline ahead of its own updates, and its retry inserts nothing", async () => {
  const history = await documentWithHistory();
  const { committed, created, frontier, owner, root } = history;
  const group = await currentSigner(history)({
    ranges: baselineSegmentRanges(frontier, 3),
  });
  const { baselineStageId, final, staged } = await stageAllButFinal(
    owner,
    created.id,
    group,
    { contentKeyEpoch: created.contentKeyEpoch },
  );
  const trailing = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const request: DocumentSyncRequest = {
    ...trailing.request,
    baselineStageId,
    outgoingUpdates: [final, ...trailing.request.outgoingUpdates],
  };

  const response = await postDocumentSync(owner, created.id, request);
  expect(response.status).toBe(200);
  const synced: DocumentSyncResponse = await response.json();
  // The request acknowledges the updates it carried; the staged segments
  // were acknowledged when they were staged.
  expect(synced.acceptedOutgoingUpdateIds).toEqual([
    final.id,
    trailing.updateId,
  ]);
  const committedIds = [
    ...committed.map((update) => update.id),
    ...group.map((segment) => segment.id),
    trailing.updateId,
  ];
  expect((await storedUpdates(created.id)).map((row) => row.id)).toEqual(
    committedIds,
  );
  expect(await updateCount(created.id)).toBe(committedIds.length);
  expect((await stagedRows(created.id)).stages).toEqual([]);

  // A retry whose acknowledgement was lost finds its final segment
  // committed and no stage, and inserts nothing.
  const retried = await postDocumentSync(owner, created.id, request);
  expect(retried.status).toBe(200);
  expect((await retried.json()).acceptedOutgoingUpdateIds).toEqual([
    final.id,
    trailing.updateId,
  ]);
  expect((await storedUpdates(created.id)).map((row) => row.id)).toEqual(
    committedIds,
  );
  expect((await stagedRows(created.id)).segments).toHaveLength(staged.length);
});

test("a staged baseline of more segments than one request holds commits, and a cold reader pages it whole", async () => {
  const history = await documentWithHistory();
  const { created, owner, root } = history;
  // One more update of 70 operations, so the history cuts into more
  // segments than a request's group may hold.
  const long = await createSignedDocumentSyncRequest({
    created,
    declaredSpan: peerSpan("7070", 0, 70),
    owner,
    root,
  });
  expect((await postDocumentSync(owner, created.id, long.request)).status).toBe(
    200,
  );
  const frontier = mergeVersionVectors([
    history.frontier,
    ...long.request.outgoingUpdates.map(
      (update) => update.partialEndVersionVector,
    ),
  ]);
  const sign = currentSigner(history);
  const commit = async () => {
    const group = await sign({ ranges: baselineSegmentRanges(frontier, 1000) });
    expect(group.length).toBeGreaterThan(MAX_DOCUMENT_BASELINE_SEGMENTS);
    // Sent inline, a group this long is not a request the API reads.
    const inline = await postDocumentSync(owner, created.id, {
      ...long.request,
      outgoingUpdates: group,
    });
    expect(inline.status).toBe(400);
    const { baselineStageId, final } = await stageAllButFinal(
      owner,
      created.id,
      group,
      { contentKeyEpoch: created.contentKeyEpoch },
    );
    const response = await postDocumentSync(owner, created.id, {
      ...long.request,
      baselineStageId,
      outgoingUpdates: [final],
    });
    expect(response.status).toBe(200);
    return group;
  };
  const first = await commit();
  const before = (await storedUpdates(created.id)).length;
  expect(before).toBe(4 + first.length);

  const coldPull = async () =>
    (await pullAsNewReader(owner, created.id, created, 64)).flatMap(
      (page) => page.updates,
    );
  // Every segment, in index order, over as many pages as they take, and
  // nothing from before the group.
  const served = await coldPull();
  expect(served.map(groupFields)).toEqual(first.map(groupFields));
  expect(served.map((update) => update.encryptedData)).toEqual(
    first.map((segment) => segment.encryptedData),
  );

  // A second baseline at the same epoch: a new reader is started at the
  // latest whole group and is served that one alone.
  const second = await commit();
  expect((await storedUpdates(created.id)).length).toBe(before + second.length);
  expect((await coldPull()).map((update) => update.id)).toEqual(
    second.map((segment) => segment.id),
  );
}, 120_000);

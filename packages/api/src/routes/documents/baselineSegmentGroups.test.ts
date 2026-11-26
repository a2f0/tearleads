// A rotation baseline is an ordered group of ordinary updates, its segments,
// sent whole in the request that rotates and committed with it or not at
// all. These tests send groups through both rotation paths: the unlink's
// `rotationBaseline` and a sync's outgoing updates.
import { expect, test } from "bun:test";
import { mergeVersionVectors, versionVectorsEqual } from "@tearleads/loro";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  type DocumentSyncResponse,
  isDocumentLinkSetMutationResponse,
} from "@tearleads/validators/response";
import {
  documentWithHistory,
  groupFields,
  linkedForUnlink,
  postJson,
  pullAsNewReader,
  storedUpdates,
} from "../../../test/helpers/baselineGroupRouteKit";
import {
  baselineSegmentRanges,
  createSignedBaselineGroup,
} from "../../../test/helpers/documentBaselineGroups";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";

test("an unlink commits a baseline of several segments whole, and a new reader pages through it", async () => {
  const history = await documentWithHistory();
  const { committed, created, frontier, owner } = history;
  const unlink = await linkedForUnlink(history);
  const cursor = committed[0]?.id;
  const unlinkRequest = await unlink({
    rotationBaselineCoversThroughUpdateId: cursor,
    rotationBaselineSegments: 3,
  });
  const segments = unlinkRequest.rotationBaseline ?? [];
  expect(segments).toHaveLength(3);

  const unlinkResponse = await postJson(
    owner,
    `/documents/${created.id}/unlink`,
    unlinkRequest,
  );
  expect(unlinkResponse.status).toBe(200);
  const unlinked = await unlinkResponse.json();
  expect(isDocumentLinkSetMutationResponse(unlinked)).toBe(true);

  // The segments are ordinary rows after the history they carry, in index
  // order: one insert takes them in request order, so sequences rise with
  // the index. Only the final row holds the count, digest and cursor.
  const stored = (await storedUpdates(created.id)).slice(committed.length);
  expect(stored.map(({ sequence: _, ...row }) => row)).toEqual(
    segments.map((segment, index) => ({
      baselineCoversThroughUpdateId:
        index === 2 ? (segment.coversThroughUpdateId ?? null) : null,
      baselineId: segment.baselineId ?? null,
      baselineSegmentCount: index === 2 ? 3 : null,
      baselineSegmentIndex: index,
      baselineSegmentsDigest:
        index === 2 ? (segment.baselineSegmentsDigest ?? null) : null,
      id: segment.id,
    })),
  );
  expect(stored[2]?.baselineCoversThroughUpdateId).toBe(cursor ?? null);
  const sequences = stored.map((row) => row.sequence);
  expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
  expect(new Set(sequences).size).toBe(3);

  // A reader that holds nothing is started at the group's first segment and
  // pages through the group: every segment once, in order, with the group
  // fields its writer signed, and no update of the rotated-away epoch.
  const pages = await pullAsNewReader(owner, created.id, unlinked, 2);
  expect(pages.map((page) => page.updates.length)).toEqual([2, 1]);
  const served = pages.flatMap((page) => page.updates);
  expect(served.map(groupFields)).toEqual(segments.map(groupFields));
  expect(pages.at(-1)?.pullPage?.throughUpdateId).toBe(segments[2]?.id);
  // Together the served segments reach the committed frontier.
  expect(
    versionVectorsEqual(
      mergeVersionVectors(
        served.map((update) => update.partialEndVersionVector),
      ),
      frontier,
    ),
  ).toBe(true);
  expect(pages.flatMap((page) => page.contentKeyBundles)).toEqual([]);
});

test("a sync commits a baseline of several segments whole, with the updates after it", async () => {
  const history = await documentWithHistory();
  const { committed, created, frontier, owner, root } = history;
  const organizationId = String(
    Reflect.get(created.accessManifest.state, "organizationId"),
  );
  const segments = await createSignedBaselineGroup({
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch,
    dependencyManifestHashes: [root.bundle.manifestHash],
    documentId: created.id,
    organizationId,
    owner,
    ranges: baselineSegmentRanges(frontier, 3),
    targetHash: created.targetHash,
  });
  expect(segments).toHaveLength(3);
  const trailing = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const request: DocumentSyncRequest = {
    ...trailing.request,
    outgoingUpdates: [...segments, ...trailing.request.outgoingUpdates],
  };

  const response = await postDocumentSync(owner, created.id, request);
  expect(response.status).toBe(200);
  const synced: DocumentSyncResponse = await response.json();
  expect(synced.acceptedOutgoingUpdateIds).toEqual([
    ...segments.map((segment) => segment.id),
    trailing.updateId,
  ]);
  const stored = (await storedUpdates(created.id)).slice(committed.length);
  expect(stored.map((row) => row.id)).toEqual([
    ...segments.map((segment) => segment.id),
    trailing.updateId,
  ]);
  expect(stored.map((row) => row.baselineSegmentIndex)).toEqual([
    0,
    1,
    2,
    null,
  ]);

  // An identical retry finds the whole group committed and inserts nothing.
  const retried = await postDocumentSync(owner, created.id, request);
  expect(retried.status).toBe(200);
  expect(await storedUpdates(created.id)).toHaveLength(committed.length + 4);
});

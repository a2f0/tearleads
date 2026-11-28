// A commit extends only peers its writer owns or that nobody does. A stage
// that extends another user's peer could not commit as things stand, so
// its segment is refused when it is staged, before anything of it is
// stored. The commit's own check, under the document head lock, stays the
// one that decides (`baselineStageCommitRefusals.test.ts`).
import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentBaselineSegments,
  documentPeerOwners,
} from "@tearleads/api-shared/schema";
import { compareCanonicalStrings } from "@tearleads/crypto";
import {
  decodeVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import {
  peerRanges,
  signerFor,
} from "../../../test/helpers/baselineGroupRefusals";
import { documentWithHistory } from "../../../test/helpers/baselineGroupRouteKit";
import {
  openStage,
  putSegment,
  stageAllButFinal,
  stagedRows,
} from "../../../test/helpers/baselineStageKit";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";

function giveToAnotherUser(documentId: string, peerId: string) {
  return db
    .update(documentPeerOwners)
    .set({ ownerUserId: crypto.randomUUID() })
    .where(
      and(
        eq(documentPeerOwners.documentId, documentId),
        eq(documentPeerOwners.peerId, peerId),
      ),
    );
}

test("a segment that extends another user's peer is refused when it is staged", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner, root } = history;
  const sign = signerFor(history, {
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch,
    dependencyManifestHashes: [root.bundle.manifestHash],
    targetHash: created.targetHash,
  });
  // A group has one segment a peer, in canonical peer order, so the first
  // peer's segment is the first staged and never the final one.
  const committed = [...decodeVersionVector(frontier).toJSON()].sort(
    ([left], [right]) => compareCanonicalStrings(left, right),
  );
  const [first] = committed;
  if (!first) throw new Error("Expected a committed peer");
  const [foreignPeer, foreignEnd] = first;
  // Another user owns that committed peer.
  await giveToAnotherUser(created.id, foreignPeer);
  const staging = async (counters: Record<string, number>) => {
    const group = await sign({
      ranges: peerRanges(encodeVersionVectorCounters(counters)),
    });
    const baselineId = group[0]?.baselineId;
    if (baselineId === undefined) throw new Error("Expected a group");
    const opened = await openStage(owner, created.id, {
      baselineId,
      contentKeyEpoch: created.contentKeyEpoch,
    });
    expect(opened.status).toBe(200);
    return { baselineId, group };
  };

  // One operation past what is committed on the other user's peer.
  const extending = await staging({
    ...Object.fromEntries(committed),
    [foreignPeer]: foreignEnd + 1,
  });
  const [foreign] = extending.group;
  if (!foreign) throw new Error("Expected a segment");
  expect([
    ...decodeVersionVector(foreign.partialEndVersionVector).toJSON(),
  ]).toEqual([[foreignPeer, foreignEnd + 1]]);
  const refused = await putSegment(owner, created.id, foreign);
  expect([refused.status, await refused.json()]).toEqual([
    409,
    {
      code: STAGE.segmentInvalid,
      error:
        "Document baseline segment cannot be staged: it extends a peer another user owns",
    },
  ]);
  expect(await stagedRows(created.id)).toEqual({
    segments: [],
    spans: [],
    stages: [{ id: extending.baselineId, nextSegmentIndex: 0 }],
  });

  // The same peer up to its committed frontier is a re-assertion, which any
  // writer may stage, and a peer nobody owns may be extended.
  const reasserting = await staging({
    ...Object.fromEntries(committed),
    "909090": 2,
  });
  for (const segment of reasserting.group.slice(0, -1)) {
    expect((await putSegment(owner, created.id, segment)).status).toBe(200);
  }
});

// A refused commit keeps its stage, so its writer can send it again. The
// request's own updates are judged before the stage is promoted, against
// the frontier and the owners the promotion would leave, so a request that
// is refused for them does none of the promotion's writes. A refusal rolls
// its writes back, so they cannot be seen afterwards; a tripwire shows
// them. One staged row is removed: the promotion counts the rows it
// inserts, and if it ran before the request was judged it would fail on
// that count, with its own error, ahead of the refusal for the peer.
test("a commit refused for its final segment promotes nothing first", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner, root } = history;
  const committed = [...decodeVersionVector(frontier).toJSON()].sort(
    ([left], [right]) => compareCanonicalStrings(left, right),
  );
  const last = committed.at(-1);
  if (!last) throw new Error("Expected a committed peer");
  const [foreignPeer, foreignEnd] = last;
  // The final segment carries one operation more than is committed on the
  // last peer; the staged segments only re-assert the others.
  const group = await signerFor(history, {
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch,
    dependencyManifestHashes: [root.bundle.manifestHash],
    targetHash: created.targetHash,
  })({
    ranges: peerRanges(
      encodeVersionVectorCounters({
        ...Object.fromEntries(committed),
        [foreignPeer]: foreignEnd + 1,
      }),
    ),
  });
  const { baselineStageId, final, staged } = await stageAllButFinal(
    owner,
    created.id,
    group,
    { contentKeyEpoch: created.contentKeyEpoch },
  );
  expect(staged.length).toBeGreaterThan(1);
  await giveToAnotherUser(created.id, foreignPeer);
  const [tripwire] = staged;
  if (!tripwire) throw new Error("Expected a staged segment");
  await db
    .delete(documentBaselineSegments)
    .where(eq(documentBaselineSegments.updateId, tripwire.id));
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });

  const refused = await postDocumentSync(owner, created.id, {
    ...request,
    baselineStageId,
    outgoingUpdates: [final],
  });
  expect([refused.status, await refused.json()]).toEqual([
    409,
    {
      code: DOCUMENT_SYNC_ERROR_CODES.peerOwned,
      error: "Document peer is owned by another user",
      peerFrontiers: [{ committedEndCounter: foreignEnd, peerId: foreignPeer }],
    },
  ]);
  expect((await stagedRows(created.id)).stages).toEqual([
    { id: baselineStageId, nextSegmentIndex: staged.length },
  ]);
});

// The request's own updates are judged before the stage is promoted, so
// they are judged against what the promotion will leave: a final segment
// that continues a peer only the stage carries, and depends on the staged
// operations, builds on nothing uncommitted.
test("a final segment builds on the peers its stage extends", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner, root } = history;
  const fresh = (start: number, end: number) => ({
    partialEndVersionVector: encodeVersionVectorCounters({ "909090": end }),
    partialStartVersionVector: encodeVersionVectorCounters(
      start === 0 ? {} : { "909090": start },
    ),
  });
  const group = await signerFor(history, {
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch,
    dependencyManifestHashes: [root.bundle.manifestHash],
    targetHash: created.targetHash,
  })({ ranges: [...peerRanges(frontier), fresh(0, 2), fresh(2, 4)] });
  const { baselineStageId, final } = await stageAllButFinal(
    owner,
    created.id,
    group,
    { contentKeyEpoch: created.contentKeyEpoch },
  );
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const committed = await postDocumentSync(owner, created.id, {
    ...request,
    baselineStageId,
    outgoingUpdates: [final, ...request.outgoingUpdates],
  });
  expect(committed.status).toBe(200);
  expect(
    await db
      .select({ ownerUserId: documentPeerOwners.ownerUserId })
      .from(documentPeerOwners)
      .where(
        and(
          eq(documentPeerOwners.documentId, created.id),
          eq(documentPeerOwners.peerId, "909090"),
        ),
      ),
  ).toEqual([{ ownerUserId: owner.userId }]);
});

test("a staged baseline admits a foreign peer inside its post-purge restorable window without claiming ownership", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner, root } = history;
  const committed = [...decodeVersionVector(frontier).toJSON()].sort(
    ([left], [right]) => compareCanonicalStrings(left, right),
  );
  const [first] = committed;
  if (!first) throw new Error("Expected a committed peer");
  const [foreignPeer, foreignEnd] = first;
  const originalOwnerId = crypto.randomUUID();
  await db
    .update(documentPeerOwners)
    .set({
      allowMemberRestore: false,
      ownerUserId: originalOwnerId,
      recoveryOwnerUserId: owner.userId,
      restorableEndCounter: foreignEnd + 2,
    })
    .where(
      and(
        eq(documentPeerOwners.documentId, created.id),
        eq(documentPeerOwners.peerId, foreignPeer),
      ),
    );
  const sign = signerFor(history, {
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch,
    dependencyManifestHashes: [root.bundle.manifestHash],
    targetHash: created.targetHash,
  });

  // Extending within restorableEndCounter (foreignEnd + 2) stages and promotes
  // cleanly while preserving originalOwnerId on document_peer_owners.
  const withinWindow = await sign({
    ranges: peerRanges(
      encodeVersionVectorCounters({
        ...Object.fromEntries(committed),
        [foreignPeer]: foreignEnd + 2,
      }),
    ),
  });
  const { baselineStageId, final } = await stageAllButFinal(
    owner,
    created.id,
    withinWindow,
    { contentKeyEpoch: created.contentKeyEpoch },
  );
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const committedResult = await postDocumentSync(owner, created.id, {
    ...request,
    baselineStageId,
    outgoingUpdates: [final],
  });
  expect(committedResult.status).toBe(200);
  expect(
    await db
      .select({ ownerUserId: documentPeerOwners.ownerUserId })
      .from(documentPeerOwners)
      .where(
        and(
          eq(documentPeerOwners.documentId, created.id),
          eq(documentPeerOwners.peerId, foreignPeer),
        ),
      ),
  ).toEqual([{ ownerUserId: originalOwnerId }]);

  // Extending past restorableEndCounter (foreignEnd + 3) is still refused.
  const pastWindow = await sign({
    ranges: peerRanges(
      encodeVersionVectorCounters({
        ...Object.fromEntries(committed),
        [foreignPeer]: foreignEnd + 3,
      }),
    ),
  });
  const [firstPast] = pastWindow;
  if (!firstPast?.baselineId) throw new Error("Expected a segment");
  const opened = await openStage(owner, created.id, {
    baselineId: firstPast.baselineId,
    contentKeyEpoch: created.contentKeyEpoch,
  });
  expect(opened.status).toBe(200);
  const refused = await putSegment(owner, created.id, firstPast);
  expect(refused.status).toBe(409);
});

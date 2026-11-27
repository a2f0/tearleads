// A request that commits a staged baseline is refused whole when its stage
// cannot be used or the group it closes breaks a rule. The refusal writes
// nothing, leaves the stage as it was, and says what the stage is worth.
import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentBaselineStages,
  documentPeerOwners,
} from "@tearleads/api-shared/schema";
import { signWriteHeader } from "@tearleads/crypto";
import {
  decodeVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import {
  DOCUMENT_MUTATION_ERROR_CODES,
  DOCUMENT_SYNC_ERROR_CODES,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import {
  expectNothingWritten,
  peerRanges,
  REFUSED_GROUPS,
  signerFor,
} from "../../../test/helpers/baselineGroupRefusals";
import {
  documentWithHistory,
  GROUP_INVALID,
  type History,
  linkedForUnlink,
  NOT_WHOLE,
  postJson,
  storedUpdates,
} from "../../../test/helpers/baselineGroupRouteKit";
import {
  abandonStage,
  openStage,
  putSegment,
  putSegmentHeader,
  stageAllButFinal,
  stagedRows,
} from "../../../test/helpers/baselineStageKit";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { readWriteHeader } from "../../workflows/documents/mutations/shared/records";

async function stagedHistory() {
  const history = await documentWithHistory();
  const { created, owner, root } = history;
  const sign = signerFor(history, {
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch,
    dependencyManifestHashes: [root.bundle.manifestHash],
    targetHash: created.targetHash,
  });
  const trailing = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const commit = (
    baselineStageId: string,
    outgoingUpdates: DocumentOutgoingUpdate[],
  ) =>
    postDocumentSync(owner, created.id, {
      ...trailing.request,
      baselineStageId,
      outgoingUpdates,
    });
  const stage = (group: readonly DocumentOutgoingUpdate[]) =>
    stageAllButFinal(owner, created.id, group, {
      contentKeyEpoch: created.contentKeyEpoch,
    });
  return { commit, history, sign, stage, trailing };
}

function setStage(
  history: History,
  baselineId: string,
  values: Partial<typeof documentBaselineStages.$inferInsert>,
) {
  return db
    .update(documentBaselineStages)
    .set(values)
    .where(
      and(
        eq(documentBaselineStages.documentId, history.created.id),
        eq(documentBaselineStages.id, baselineId),
      ),
    );
}

test("a sync refuses a stage that cannot be committed, with the stage's code, and writes nothing", async () => {
  const { commit, history, sign, stage } = await stagedHistory();
  const { created, frontier, owner } = history;
  const group = await sign({ ranges: peerRanges(frontier) });
  const { baselineStageId, final, staged, status } = await stage(group);
  const refusedWith = async (
    response: Response,
    baselineStageCode: string,
    reason: string,
  ) => {
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      baselineStageCode,
      code: GROUP_INVALID,
      error: `${NOT_WHOLE}${reason}`,
    });
    await expectNothingWritten(history);
    // The stage is as it was: a refused commit consumes nothing.
    expect(await stagedRows(created.id)).toMatchObject({
      segments: staged.map((segment) => ({ updateId: segment.id })),
      stages: [{ id: baselineStageId, nextSegmentIndex: staged.length }],
    });
  };
  const open = {
    contentKeyCommitment: status.contentKeyCommitment,
    contentKeyEpoch: status.contentKeyEpoch,
    expiresAt: new Date(status.expiresAt),
    ownerUserId: owner.userId,
  };

  // No stage under the id the request names.
  const missing = await commit(crypto.randomUUID(), [final]);
  expect(missing.status).toBe(409);
  expect((await missing.json()).error).toBe(
    `${NOT_WHOLE}the segments name more than one baseline`,
  );
  await setStage(history, baselineStageId, {
    ownerUserId: crypto.randomUUID(),
  });
  await refusedWith(
    await commit(baselineStageId, [final]),
    STAGE.notFound,
    "its stage does not exist",
  );
  await setStage(history, baselineStageId, {
    ...open,
    expiresAt: new Date(Date.now() - 1000),
  });
  await refusedWith(
    await commit(baselineStageId, [final]),
    STAGE.expired,
    "its stage expired",
  );
  await setStage(history, baselineStageId, {
    ...open,
    contentKeyEpoch: status.contentKeyEpoch + 1,
  });
  await refusedWith(
    await commit(baselineStageId, [final]),
    STAGE.epochStale,
    "its stage is for another content-key epoch",
  );
  await setStage(history, baselineStageId, {
    ...open,
    contentKeyCommitment: "d".repeat(64),
  });
  await refusedWith(
    await commit(baselineStageId, [final]),
    STAGE.epochStale,
    "its stage is for another content key",
  );
  await setStage(history, baselineStageId, open);

  // A final segment that is not next in line: the stage holds two segments
  // and this one signs index 1.
  const [, early] = await sign({
    baselineId: baselineStageId,
    ranges: peerRanges(frontier).slice(0, 2),
  });
  if (!early) throw new Error("Expected a final segment");
  await refusedWith(
    await commit(baselineStageId, [early]),
    STAGE.segmentOutOfOrder,
    "the segments are not in index order from zero",
  );

  // Staged headers signed for another manifest than the final segment's.
  // The ciphertext is still good: the writer signs the headers again, and
  // the same request then commits.
  const resign = async (segment: DocumentOutgoingUpdate, manifest: string) => {
    const { signature: _, ...unsigned } = readWriteHeader(
      segment.writeHeader,
      "write header",
    );
    const response = await putSegmentHeader(
      owner,
      created.id,
      baselineStageId,
      segment.baselineSegmentIndex ?? 0,
      await signWriteHeader(
        { ...unsigned, accessManifestHash: manifest },
        owner.signing.signingPrivateKey,
      ),
    );
    expect(response.status).toBe(200);
  };
  const [moved] = staged;
  if (!moved) throw new Error("Expected a staged segment");
  await resign(moved, "e".repeat(64));
  await refusedWith(
    await commit(baselineStageId, [final]),
    STAGE.headersStale,
    "its staged write headers were signed for another manifest, key-target set or writer key",
  );
  await resign(moved, created.manifestHash);
  expect((await commit(baselineStageId, [final])).status).toBe(200);
  expect(await storedUpdates(created.id)).toHaveLength(
    history.committed.length + group.length,
  );
});

test("a staged baseline that omits a committed update is stale on either route", async () => {
  const { commit, history, sign, stage } = await stagedHistory();
  const { created, frontier, owner } = history;
  // The group carries two of the three committed peers: the stage and the
  // final segment are sound, and together they stop short of the frontier.
  const short = await stage(
    await sign({ ranges: peerRanges(frontier).slice(0, 2) }),
  );
  const refused = await commit(short.baselineStageId, [short.final]);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({
    code: DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
    error:
      "Document content-key rotation baseline does not cover the committed frontier",
  });
  await expectNothingWritten(history);
  expect((await stagedRows(created.id)).stages).toHaveLength(1);
  await abandonStage(owner, created.id, short.baselineStageId);

  // A group that covered the frontier when it was staged, and an update
  // committed since: the writer stages a tail segment and commits again.
  const whole = await stage(await sign({ ranges: peerRanges(frontier) }));
  const racing = await createSignedDocumentSyncRequest({
    created,
    owner,
    root: history.root,
  });
  expect(
    (await postDocumentSync(owner, created.id, racing.request)).status,
  ).toBe(200);
  const late = await commit(whole.baselineStageId, [whole.final]);
  expect(late.status).toBe(409);
  expect((await late.json()).code).toBe(
    DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
  );
  expect((await storedUpdates(created.id)).map((row) => row.id)).toEqual([
    ...history.committed.map((update) => update.id),
    racing.updateId,
  ]);
  expect(await stagedRows(created.id)).toMatchObject({
    stages: [{ id: whole.baselineStageId, nextSegmentIndex: 2 }],
  });
});

test("an unlink refuses a staged baseline that stops short of the committed frontier", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner } = history;
  const unlink = await linkedForUnlink(history);
  const request = await unlink({
    rotationBaselineRanges: peerRanges(frontier).slice(0, 2),
  });
  const staged = await stageAllButFinal(
    owner,
    created.id,
    request.rotationBaseline ?? [],
    { contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch },
  );
  const response = await postJson(owner, `/documents/${created.id}/unlink`, {
    ...request,
    baselineStageId: staged.baselineStageId,
    rotationBaseline: [staged.final],
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    code: DOCUMENT_MUTATION_ERROR_CODES.unlinkRotationBaselineStale,
    error: "Document unlink rotation baseline is stale",
  });
  await expectNothingWritten(history);
  expect(await stagedRows(created.id)).toMatchObject({
    stages: [{ id: staged.baselineStageId, nextSegmentIndex: 1 }],
  });

  // A link never carries a baseline, staged or not, and a stage is named
  // only with its final segment.
  const { rotationBaseline: _, ...bare } = request;
  const withoutFinal = await postJson(
    owner,
    `/documents/${created.id}/unlink`,
    {
      ...bare,
      baselineStageId: staged.baselineStageId,
    },
  );
  expect(withoutFinal.status).toBe(400);
  await expectNothingWritten(history);
});

// Every rule a group sent in one request is held to holds for a group sent
// through a stage: each group that breaks one is refused when a segment is
// staged or when the final segment commits, and nothing is written.
test("every group rule refuses the staged equivalent", async () => {
  const { commit, history, sign } = await stagedHistory();
  const { created, frontier, owner } = history;
  const stageCodes: string[] = Object.values(STAGE);
  for (const refused of REFUSED_GROUPS) {
    const group = await refused.baseline({ frontier, sign });
    const final = group.at(-1);
    const baselineId = final?.baselineId;
    if (!final || baselineId === undefined) throw new Error(refused.name);
    expect(
      (
        await openStage(owner, created.id, {
          baselineId,
          contentKeyEpoch: created.contentKeyEpoch,
        })
      ).status,
    ).toBe(200);
    // Stage each segment before the final one at its place in the group,
    // as a writer would; the first refusal is the group's.
    let refusal: {
      readonly codes: readonly string[];
      readonly response: Response;
    } | null = null;
    for (const [index, segment] of group.slice(0, -1).entries()) {
      const response = await putSegment(owner, created.id, segment, {
        baselineId,
        index,
      });
      if (response.status === 200) continue;
      refusal = { codes: stageCodes, response };
      break;
    }
    refusal ??= {
      codes: [GROUP_INVALID],
      response: await commit(baselineId, [final]),
    };
    expect([refused.name, refusal.response.status]).toEqual([
      refused.name,
      409,
    ]);
    const { code } = await refusal.response.json();
    expect([refused.name, refusal.codes.includes(code)]).toEqual([
      refused.name,
      true,
    ]);
    await expectNothingWritten(history);
    await abandonStage(owner, created.id, baselineId);
  }
});

// The staged equivalents above break the walk in a staged segment. The
// final segment travels in the committing request and is walked there,
// against where the stage's segments left each peer.
test("a final segment that does not continue the staged history is refused", async () => {
  const { commit, history, sign, stage } = await stagedHistory();
  const { created, frontier, owner } = history;
  const [first, second, third] = peerRanges(frontier);
  if (!first || !second || !third) throw new Error("Expected three ranges");
  const [thirdPeer] = decodeVersionVector(third.partialEndVersionVector)
    .toJSON()
    .keys();
  if (thirdPeer === undefined) throw new Error("Expected a peer");
  const broken = [
    // Its span starts past where the stage left the peer: at 1, not zero.
    {
      dependencyVersionVector: third.partialStartVersionVector,
      partialEndVersionVector: encodeVersionVectorCounters({ [thirdPeer]: 2 }),
      partialStartVersionVector: encodeVersionVectorCounters({
        [thirdPeer]: 1,
      }),
    },
    // It depends on an operation neither the stage nor it carries.
    {
      ...third,
      dependencyVersionVector: encodeVersionVectorCounters({ "424242": 1 }),
    },
    // Its dependencies name a peer and no operation.
    {
      ...third,
      dependencyVersionVector: encodeVersionVectorCounters({ "424242": 0 }),
    },
  ];
  for (const range of broken) {
    const { baselineStageId, final } = await stage(
      await sign({ ranges: [first, second, range] }),
    );
    const response = await commit(baselineStageId, [final]);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: GROUP_INVALID,
      error: `${NOT_WHOLE}the segments do not carry each peer's operations gapless from zero, each depending only on earlier segments`,
    });
    await expectNothingWritten(history);
    await abandonStage(owner, created.id, baselineStageId);
  }
});

test("a commit that names a stage carries the final segment alone, first", async () => {
  const { commit, history, sign, stage, trailing } = await stagedHistory();
  const { frontier } = history;
  const group = await sign({ ranges: peerRanges(frontier) });
  const { baselineStageId, final, staged } = await stage(group);
  const [ordinary] = trailing.request.outgoingUpdates;
  if (!ordinary) throw new Error("Expected an ordinary update");
  for (const [outgoingUpdates, reason] of [
    [
      [...staged, final],
      "a request that commits a staged baseline carries its final segment alone",
    ],
    [
      [ordinary],
      "a request that commits a staged baseline carries its final segment alone",
    ],
    [[ordinary, final], "other updates come ahead of its segments"],
  ] satisfies [DocumentOutgoingUpdate[], string][]) {
    const response = await commit(baselineStageId, outgoingUpdates);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: GROUP_INVALID,
      error: `${NOT_WHOLE}${reason}`,
    });
    await expectNothingWritten(history);
  }
  expect((await commit(baselineStageId, [final, ordinary])).status).toBe(200);
});

test("a staged baseline extends only peers its writer owns or that nobody does", async () => {
  const { commit, history, sign, stage } = await stagedHistory();
  const { created, frontier, owner } = history;
  const committed = [...decodeVersionVector(frontier).toJSON()];
  const [ownedPeer, ownedEnd] = committed[0] ?? ["", 0];
  // The group carries one operation more than is committed on a peer, and
  // a peer nothing has committed.
  const extended = encodeVersionVectorCounters({
    ...Object.fromEntries(committed),
    [ownedPeer]: ownedEnd + 1,
    "909090": 2,
  });
  const group = await sign({ ranges: peerRanges(extended) });
  const { baselineStageId, final } = await stage(group);
  const ownerOf = (peerId: string) =>
    db
      .select({ ownerUserId: documentPeerOwners.ownerUserId })
      .from(documentPeerOwners)
      .where(
        and(
          eq(documentPeerOwners.documentId, created.id),
          eq(documentPeerOwners.peerId, peerId),
        ),
      );

  // Another user owns the peer the stage extends past its frontier.
  const other = crypto.randomUUID();
  const setOwner = (ownerUserId: string) =>
    db
      .update(documentPeerOwners)
      .set({ ownerUserId })
      .where(
        and(
          eq(documentPeerOwners.documentId, created.id),
          eq(documentPeerOwners.peerId, ownedPeer),
        ),
      );
  await setOwner(other);
  const refused = await commit(baselineStageId, [final]);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({
    code: DOCUMENT_SYNC_ERROR_CODES.peerOwned,
    error: "Document peer is owned by another user",
    peerFrontiers: [{ committedEndCounter: ownedEnd, peerId: ownedPeer }],
  });
  await expectNothingWritten(history);
  expect(await ownerOf("909090")).toEqual([]);

  // The writer's own peer extends, and the unowned one becomes the writer's.
  await setOwner(owner.userId);
  expect((await commit(baselineStageId, [final])).status).toBe(200);
  expect(await ownerOf("909090")).toEqual([{ ownerUserId: owner.userId }]);
});

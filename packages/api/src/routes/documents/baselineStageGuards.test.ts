// What every stage request is held to before it writes: ids in their
// canonical spelling, the caller's access and its organization's standing
// now, and a content record no other update holds.
import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documentBaselineStages } from "@tearleads/api-shared/schema";
import {
  extendDocumentBaselineSegmentsDigest,
  startDocumentBaselineSegmentsDigest,
} from "@tearleads/crypto";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import { DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  expectNothingWritten,
  peerRanges,
  signerFor,
} from "../../../test/helpers/baselineGroupRefusals";
import {
  documentWithHistory,
  GROUP_INVALID,
  type History,
  NOT_WHOLE,
  storedUpdates,
} from "../../../test/helpers/baselineGroupRouteKit";
import {
  abandonStage,
  getStage,
  openStage,
  putSegment,
  putSegmentHeader,
  stageAllButFinal,
  stagedRows,
} from "../../../test/helpers/baselineStageKit";
import {
  baselineSegmentRanges,
  createSignedBaselineGroup,
} from "../../../test/helpers/documentBaselineGroups";
import { CONTENT_KEY_COMMITMENT_FIXTURE } from "../../../test/helpers/documentEnvelopeFixture";
import { sharedWriterDocument } from "../../../test/helpers/documentPeerOwnership";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { buildRootRevokeRequest } from "../../../test/helpers/keyingWriterProjectionRevoke";
import { setTestOrganizationBillingLocal } from "../../../test/helpers/organizationBilling";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { routeApp } from "../../routeApp";
import {
  openDocumentBaselineStage,
  resignStagedBaselineSegmentHeader,
  stageDocumentBaselineSegment,
} from "../../workflows/documents/baselineStages";
import { readWriteHeader } from "../../workflows/documents/mutations/shared/records";

function currentSigner(history: History) {
  const { created, root } = history;
  return signerFor(history, {
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch,
    dependencyManifestHashes: [root.bundle.manifestHash],
    targetHash: created.targetHash,
  });
}

// A stage's digest starts from the document id, and a reader starts its own
// from the id it holds. A stage opened under another spelling of the id
// would commit a group whose signed digest no reader can reproduce.
test("a stage route takes only canonical ids, and a stage is rooted in the stored document id", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner } = history;
  const upper = created.id.toUpperCase();
  const [first] = await currentSigner(history)({
    ranges: peerRanges(frontier),
  });
  if (!first?.baselineId) throw new Error("Expected a segment");
  const baselineId = first.baselineId;
  const stage = { baselineId, contentKeyEpoch: created.contentKeyEpoch };

  // Every route refuses a document or baseline id that is not canonical,
  // before it reads anything.
  expect((await openStage(owner, upper, stage)).status).toBe(400);
  expect((await openStage(owner, created.id, stage)).status).toBe(200);
  for (const [documentId, id] of [
    [upper, baselineId],
    [created.id, baselineId.toUpperCase()],
  ] satisfies [string, string][]) {
    for (const response of [
      await getStage(owner, documentId, id),
      await putSegment(owner, documentId, first, { baselineId: id }),
      await putSegmentHeader(owner, documentId, id, 0, first.writeHeader),
      await abandonStage(owner, documentId, id),
    ]) {
      expect(response.status).toBe(400);
    }
  }
  expect(await stagedRows(created.id)).toMatchObject({
    segments: [],
    stages: [{ id: baselineId, nextSegmentIndex: 0 }],
  });
  expect((await abandonStage(owner, created.id, baselineId)).status).toBe(200);

  // Below the route, a caller that names the document in another spelling
  // still gets a stage rooted in the stored one: its row, its digest, and
  // the segments staged to it.
  const honestStart = await startDocumentBaselineSegmentsDigest({
    baselineId,
    documentId: created.id,
  });
  const opened = await openDocumentBaselineStage(db, {
    documentId: upper,
    request: {
      ...stage,
      contentKeyCommitment: CONTENT_KEY_COMMITMENT_FIXTURE,
    },
    userId: owner.userId,
  });
  expect(opened.segmentsDigest).toBe(honestStart);
  const [row] = await db
    .select({ documentId: documentBaselineStages.documentId })
    .from(documentBaselineStages)
    .where(eq(documentBaselineStages.id, baselineId));
  expect(row?.documentId).toBe(created.id);
  const staged = await stageDocumentBaselineSegment(db, {
    baselineId,
    documentId: upper,
    fingerprint: owner.fingerprint,
    segment: first,
    segmentIndex: 0,
    userId: owner.userId,
  });
  expect(staged.nextSegmentIndex).toBe(1);
  expect((await stagedRows(created.id)).segments).toEqual([
    { baselineId, segmentIndex: 0, updateId: first.id },
  ]);
  // And so is a header signed again for it.
  const resigned = await resignStagedBaselineSegmentHeader(db, {
    baselineId,
    documentId: upper,
    fingerprint: owner.fingerprint,
    segmentIndex: 0,
    userId: owner.userId,
    writeHeader: first.writeHeader,
  });
  expect(resigned.segmentsDigest).toBe(staged.segmentsDigest);
});

// The request that commits a stage names the document in its own path. One
// that spells it another way is refused as any write under that spelling
// is, before the stage is touched, and the stage still commits by its
// canonical id into a group a reader reproduces.
test("a stage commits only through its document's canonical id", async () => {
  const history = await documentWithHistory();
  const { committed, created, frontier, owner, root } = history;
  const group = await currentSigner(history)({ ranges: peerRanges(frontier) });
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
  const commit = { ...request, baselineStageId, outgoingUpdates: [final] };

  const refused = await postDocumentSync(
    owner,
    created.id.toUpperCase(),
    commit,
  );
  expect(refused.status).toBe(400);
  await expectNothingWritten(history);
  expect((await stagedRows(created.id)).stages).toMatchObject([
    { id: baselineStageId, nextSegmentIndex: group.length - 1 },
  ]);

  expect((await postDocumentSync(owner, created.id, commit)).status).toBe(200);
  expect((await storedUpdates(created.id)).map((row) => row.id)).toEqual([
    ...committed.map((update) => update.id),
    ...group.map((segment) => segment.id),
  ]);
  // The digest the final segment signed is the one a reader computes from
  // the document id it holds and the segments it is served.
  let digest = await startDocumentBaselineSegmentsDigest({
    baselineId: baselineStageId,
    documentId: created.id,
  });
  for (const [segmentIndex, segment] of group.slice(0, -1).entries()) {
    const header = readWriteHeader(segment.writeHeader, "Staged write header");
    digest = await extendDocumentBaselineSegmentsDigest(digest, {
      ciphertextHash: header.ciphertextHash,
      metadataHash: header.metadataHash,
      segmentIndex,
      updateId: segment.id,
    });
  }
  expect(final.baselineSegmentsDigest).toBe(digest);
});

// Staging is a document write. A writer whose organization stopped being
// entitled to sync, as one whose access was revoked, stages nothing more,
// and its stage stops extending.
test("staging and re-signing are held to the organization's standing now", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner, root } = history;
  const [first, second] = await currentSigner(history)({
    ranges: peerRanges(frontier),
  });
  if (!first?.baselineId || !second) throw new Error("Expected segments");
  const baselineId = first.baselineId;
  const stage = { baselineId, contentKeyEpoch: created.contentKeyEpoch };
  expect((await openStage(owner, created.id, stage)).status).toBe(200);
  const before = await (await putSegment(owner, created.id, first)).json();

  await setTestOrganizationBillingLocal(
    String(Reflect.get(created.accessManifest.state, "organizationId")),
  );
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  // The control: an ordinary write is refused for payment.
  expect((await postDocumentSync(owner, created.id, request)).status).toBe(402);
  for (const refused of [
    await putSegment(owner, created.id, second),
    // A staged index sent again writes nothing, and is refused all the same.
    await putSegment(owner, created.id, first),
    await putSegmentHeader(owner, created.id, baselineId, 0, first.writeHeader),
    await openStage(owner, created.id, {
      ...stage,
      baselineId: crypto.randomUUID(),
    }),
  ]) {
    expect(refused.status).toBe(402);
  }
  // Reading the stage writes nothing and stays open, as a read-only sync
  // does; the stage has not moved, and its expiry has not been extended.
  const status = await getStage(owner, created.id, baselineId);
  expect(status.status).toBe(200);
  expect(await status.json()).toEqual(before);
  await expectNothingWritten(history);
  // A writer may always take down what it staged.
  expect((await abandonStage(owner, created.id, baselineId)).status).toBe(200);
});

// A content record, and the nonce domain derived from it, belongs to one
// update of a document's epoch. A staged segment that repeats one could
// never commit; it is refused while its writer can still sign it again.
test("a staged segment's content record is no other update's", async () => {
  const history = await documentWithHistory();
  const { committed, created, frontier, owner } = history;
  const sign = currentSigner(history);
  const ranges = peerRanges(frontier);
  const baselineId = crypto.randomUUID();
  const stage = { baselineId, contentKeyEpoch: created.contentKeyEpoch };
  expect((await openStage(owner, created.id, stage)).status).toBe(200);
  const [first] = await sign({ baselineId, ranges });
  if (!first) throw new Error("Expected a segment");
  expect((await putSegment(owner, created.id, first)).status).toBe(200);

  const committedRecord = committed[0]?.id ?? "";
  for (const taken of [first.id, committedRecord]) {
    // The second segment, under its own update id, signs a content record
    // that the first staged segment, or a committed update, holds.
    const [, repeated] = await sign({
      baselineId,
      contentRecordId: (position, updateId) =>
        position === 1 ? taken : updateId,
      ranges,
    });
    if (!repeated) throw new Error("Expected a segment");
    const response = await putSegment(owner, created.id, repeated);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe(STAGE.segmentConflict);
  }
  expect(await stagedRows(created.id)).toMatchObject({
    segments: [{ updateId: first.id }],
    stages: [{ id: baselineId, nextSegmentIndex: 1 }],
  });

  const sharedRecord = crypto.randomUUID();
  // A final segment that repeats a staged one's content record is found
  // when it commits, with the stage's code, and nothing is written.
  const group = await sign({
    baselineId: crypto.randomUUID(),
    contentRecordId: (position, updateId) =>
      position === 2 ? sharedRecord : updateId,
    ranges,
  });
  const [, , final] = group;
  const [head, middle] = await sign({
    baselineId: final?.baselineId,
    contentRecordId: (position, updateId) =>
      position === 1 ? sharedRecord : updateId,
    ranges,
  });
  if (!head?.baselineId || !middle || !final) throw new Error("Expected three");
  expect(
    (
      await openStage(owner, created.id, {
        ...stage,
        baselineId: head.baselineId,
      })
    ).status,
  ).toBe(200);
  expect((await putSegment(owner, created.id, head)).status).toBe(200);
  const staged = await putSegment(owner, created.id, middle);
  expect(staged.status).toBe(200);
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root: history.root,
  });
  const { segmentsDigest } = await staged.json();
  const [, , closing] = await sign({
    baselineId: head.baselineId,
    contentRecordId: (position, updateId) =>
      position === 2 ? sharedRecord : updateId,
    override: (fields) =>
      fields.baselineSegmentsDigest === undefined
        ? fields
        : { ...fields, baselineSegmentsDigest: segmentsDigest },
    ranges,
  });
  if (!closing) throw new Error("Expected a final segment");
  const refused = await postDocumentSync(owner, created.id, {
    ...request,
    baselineStageId: head.baselineId,
    outgoingUpdates: [closing],
  });
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({
    baselineStageCode: STAGE.segmentConflict,
    code: GROUP_INVALID,
    error: `${NOT_WHOLE}a staged segment's content record is already committed`,
  });
  await expectNothingWritten(history);
});

test("a writer whose access was revoked stages nothing more", async () => {
  const { created, owner, root, writer } = await sharedWriterDocument();
  const group = await createSignedBaselineGroup({
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch,
    dependencyManifestHashes: [root.bundle.manifestHash],
    documentId: created.id,
    organizationId: String(
      Reflect.get(created.accessManifest.state, "organizationId"),
    ),
    owner: writer,
    ranges: baselineSegmentRanges(encodeVersionVectorCounters({ "7": 3 }), 3),
    targetHash: created.targetHash,
  });
  const [first, second] = group;
  if (!first?.baselineId || !second) throw new Error("Expected segments");
  const baselineId = first.baselineId;
  const stage = { baselineId, contentKeyEpoch: created.contentKeyEpoch };
  expect((await openStage(writer, created.id, stage)).status).toBe(200);
  const before = await (await putSegment(writer, created.id, first)).json();
  expect(before.nextSegmentIndex).toBe(1);

  const revoked = await routeApp.request(
    `/containers/${root.kekState.containerId}/revoke`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await buildRootRevokeRequest({
          previous: root.bundle,
          previousKekState: root.kekState,
          revokedUser: writer,
          signer: owner,
        }),
      ),
    },
  );
  expect(revoked.status).toBe(200);

  for (const refused of [
    await putSegment(writer, created.id, second),
    await putSegmentHeader(
      writer,
      created.id,
      baselineId,
      0,
      first.writeHeader,
    ),
    await getStage(writer, created.id, baselineId),
    await openStage(writer, created.id, {
      ...stage,
      baselineId: crypto.randomUUID(),
    }),
  ]) {
    expect(refused.status).toBe(403);
  }
  // The stage is where the revoke found it: one segment, the same expiry.
  const [row] = await db
    .select()
    .from(documentBaselineStages)
    .where(eq(documentBaselineStages.id, baselineId));
  expect(row?.nextSegmentIndex).toBe(1);
  expect(row?.expiresAt.toISOString()).toBe(before.expiresAt);
  // It may still take down what it uploaded.
  expect((await abandonStage(writer, created.id, baselineId)).status).toBe(200);
  expect((await stagedRows(created.id)).stages).toEqual([]);
});

// A baseline id is free in its document when its stage opens, and no stage
// stops a request from committing a whole group under that id since. The
// staged segments would take places that group holds, so the stage can
// never commit, and its writer is told why: its id is taken.
test("a stage whose baseline id a request committed since is refused for its id", async () => {
  const history = await documentWithHistory();
  const { committed, created, frontier, owner, root } = history;
  const sign = currentSigner(history);
  const ranges = peerRanges(frontier);
  const group = await sign({ ranges });
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
  const inline = await sign({ baselineId: baselineStageId, ranges });
  expect(
    (
      await postDocumentSync(owner, created.id, {
        ...request,
        outgoingUpdates: inline,
      })
    ).status,
  ).toBe(200);
  const stored = [
    ...committed.map((update) => update.id),
    ...inline.map((segment) => segment.id),
  ];

  const refused = await postDocumentSync(owner, created.id, {
    ...request,
    baselineStageId,
    outgoingUpdates: [final],
  });
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({
    baselineStageCode: STAGE.idConflict,
    code: GROUP_INVALID,
    error: `${NOT_WHOLE}its baseline id was committed by another request`,
  });
  expect((await storedUpdates(created.id)).map((row) => row.id)).toEqual(
    stored,
  );
  // The stage is as it was, for its writer to abandon.
  expect((await stagedRows(created.id)).stages).toMatchObject([
    { id: baselineStageId, nextSegmentIndex: group.length - 1 },
  ]);
  expect((await abandonStage(owner, created.id, baselineStageId)).status).toBe(
    200,
  );
});

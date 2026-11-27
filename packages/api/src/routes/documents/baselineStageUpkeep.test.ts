// A stage does not outlive its writer's attention: it expires an hour after
// its last upload, and the hourly sweep deletes what it staged. A writer
// whose plan moved while it uploaded signs its staged headers again instead
// of uploading the ciphertext a second time.
import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documentBaselineSegments } from "@tearleads/api-shared/schema";
import { signWriteHeader } from "@tearleads/crypto";
import { DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  expectNothingWritten,
  peerRanges,
  signerFor,
} from "../../../test/helpers/baselineGroupRefusals";
import {
  documentWithHistory,
  type History,
} from "../../../test/helpers/baselineGroupRouteKit";
import {
  abandonStage,
  getStage,
  openStage,
  putSegment,
  putSegmentHeader,
  setStageExpiry,
  stagedRows,
} from "../../../test/helpers/baselineStageKit";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { cleanupExpiredDocumentBaselineStages } from "../../workflows/documents/baselineStages";
import { readWriteHeader } from "../../workflows/documents/mutations/shared/records";

/** A signer of groups at the document's current epoch and manifest. */
function currentSigner(history: History) {
  const { created, root } = history;
  return signerFor(history, {
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch,
    dependencyManifestHashes: [root.bundle.manifestHash],
    targetHash: created.targetHash,
  });
}

async function stageStatus(response: Response) {
  expect(response.status).toBe(200);
  return response.json();
}

async function stageRefusal(response: Response) {
  expect(response.status).toBe(409);
  return response.json();
}

test("an expired stage takes no upload and the sweep deletes what it staged", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner } = history;
  const [first, second] = await currentSigner(history)({
    ranges: peerRanges(frontier),
  });
  if (!first?.baselineId || !second) throw new Error("Expected segments");
  const baselineId = first.baselineId;
  const opened = await stageStatus(
    await openStage(owner, created.id, {
      baselineId,
      contentKeyEpoch: created.contentKeyEpoch,
    }),
  );
  const staged = await stageStatus(await putSegment(owner, created.id, first));
  // Each upload moves the expiry: an hour after it, on a fresh stage.
  expect(Date.parse(staged.expiresAt)).toBeGreaterThanOrEqual(
    Date.parse(opened.expiresAt),
  );
  expect(Date.parse(staged.expiresAt) - Date.now()).toBeLessThanOrEqual(
    60 * 60 * 1000,
  );

  // A sweep that runs while the stage is live leaves it alone.
  expect(await cleanupExpiredDocumentBaselineStages(db)).toMatchObject({
    failures: [],
  });
  expect((await stagedRows(created.id)).segments).toHaveLength(1);

  await setStageExpiry(created.id, baselineId, new Date(Date.now() - 1000));
  for (const expired of [
    await putSegment(owner, created.id, second),
    await getStage(owner, created.id, baselineId),
    await putSegmentHeader(owner, created.id, baselineId, 0, first.writeHeader),
  ]) {
    expect(await stageRefusal(expired)).toEqual({
      code: STAGE.expired,
      error: "Document baseline stage expired",
    });
  }
  expect((await stagedRows(created.id)).segments).toHaveLength(1);

  const swept = await cleanupExpiredDocumentBaselineStages(db);
  expect(swept.failures).toEqual([]);
  expect(swept.deletedStages).toBeGreaterThanOrEqual(1);
  expect(await stagedRows(created.id)).toEqual({
    segments: [],
    spans: [],
    stages: [],
  });
  await expectNothingWritten(history);
});

test("a staged header is signed again without its ciphertext", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner } = history;
  const [first, second] = await currentSigner(history)({
    ranges: peerRanges(frontier),
  });
  if (!first?.baselineId || !second) throw new Error("Expected segments");
  const baselineId = first.baselineId;
  await stageStatus(
    await openStage(owner, created.id, {
      baselineId,
      contentKeyEpoch: created.contentKeyEpoch,
    }),
  );
  const staged = await stageStatus(await putSegment(owner, created.id, first));
  const { signature: _, ...unsigned } = readWriteHeader(
    first.writeHeader,
    "write header",
  );
  const resign = (changes: Partial<typeof unsigned>) =>
    signWriteHeader(
      { ...unsigned, ...changes },
      owner.signing.signingPrivateKey,
    );
  const heldSegment = async () => {
    const [held] = await db
      .select()
      .from(documentBaselineSegments)
      .where(eq(documentBaselineSegments.updateId, first.id));
    if (!held) throw new Error("Expected the staged segment");
    return held;
  };
  const before = await heldSegment();

  const moved = await resign({ accessManifestHash: "e".repeat(64) });
  const resigned = await stageStatus(
    await putSegmentHeader(owner, created.id, baselineId, 0, moved),
  );
  // The stage's digest chains the ciphertext and metadata, which did not
  // change, so the digest a final segment signs is the same.
  expect(resigned.segmentsDigest).toBe(staged.segmentsDigest);
  expect(resigned.nextSegmentIndex).toBe(1);
  const after = await heldSegment();
  expect(after.header.accessManifestHash).toBe("e".repeat(64));
  expect(after.authorizationHash).not.toBe(before.authorizationHash);
  expect(after.headerHash).not.toBe(before.headerHash);
  expect(after.encryptedData).toBe(before.encryptedData);

  // A header for other bytes is not a re-sign of this segment.
  expect(
    (
      await stageRefusal(
        await putSegmentHeader(
          owner,
          created.id,
          baselineId,
          0,
          second.writeHeader,
        ),
      )
    ).code,
  ).toBe(STAGE.segmentConflict);
  // An index nothing is staged at.
  expect(
    await stageRefusal(
      await putSegmentHeader(owner, created.id, baselineId, 1, moved),
    ),
  ).toMatchObject({ code: STAGE.segmentOutOfOrder, nextSegmentIndex: 1 });
  // A header the session's key did not sign.
  const forged = await putSegmentHeader(owner, created.id, baselineId, 0, {
    ...moved,
    signature: readWriteHeader(first.writeHeader, "write header").signature,
  });
  expect(forged.status).toBeGreaterThanOrEqual(400);
  expect(forged.status).toBeLessThan(500);
  expect((await heldSegment()).headerHash).toBe(after.headerHash);
});

// An update id names one update everywhere. A staged segment whose id an
// ordinary update takes meanwhile is no update's payload: nothing reads the
// staged row, so it goes with its stage, and the id can no longer be staged.
test("a staged row outlives its stage only as a committed segment's payload", async () => {
  const history = await documentWithHistory();
  const { committed, created, frontier, owner, root } = history;
  const [first] = await currentSigner(history)({
    ranges: peerRanges(frontier),
  });
  if (!first?.baselineId) throw new Error("Expected a segment");
  const stage = {
    baselineId: first.baselineId,
    contentKeyEpoch: created.contentKeyEpoch,
  };
  await stageStatus(await openStage(owner, created.id, stage));
  await stageStatus(await putSegment(owner, created.id, first));

  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
    updateId: first.id,
  });
  expect((await postDocumentSync(owner, created.id, request)).status).toBe(200);

  await stageStatus(await abandonStage(owner, created.id, first.baselineId));
  expect(await stagedRows(created.id)).toEqual({
    segments: [],
    spans: [],
    stages: [],
  });

  await stageStatus(await openStage(owner, created.id, stage));
  expect(
    (await stageRefusal(await putSegment(owner, created.id, first))).code,
  ).toBe(STAGE.segmentConflict);
  expect((await stagedRows(created.id)).segments).toEqual([]);
  expect(committed).toHaveLength(3);
});

// The same holds for segments their writer staged and then sent whole in
// one request after all: the committed rows hold their own ciphertext, so
// the staged copies are nobody's payload and go with the stage.
test("segments committed inline leave their staged copies to the stage", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner, root } = history;
  const group = await currentSigner(history)({ ranges: peerRanges(frontier) });
  const baselineId = group[0]?.baselineId ?? "";
  await stageStatus(
    await openStage(owner, created.id, {
      baselineId,
      contentKeyEpoch: created.contentKeyEpoch,
    }),
  );
  for (const segment of group.slice(0, -1)) {
    await stageStatus(await putSegment(owner, created.id, segment));
  }
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  expect(
    (
      await postDocumentSync(owner, created.id, {
        ...request,
        outgoingUpdates: group,
      })
    ).status,
  ).toBe(200);
  expect((await stagedRows(created.id)).segments).toHaveLength(2);

  await stageStatus(await abandonStage(owner, created.id, baselineId));
  expect(await stagedRows(created.id)).toEqual({
    segments: [],
    spans: [],
    stages: [],
  });
});

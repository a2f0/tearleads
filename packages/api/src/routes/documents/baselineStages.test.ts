// A rotation baseline too large for one request is staged: its writer opens
// a stage and uploads every segment but the final one, in order, ahead of
// the request that rotates. These tests drive the stage routes; committing
// a stage is in baselineStageCommit.test.ts.
import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documentBaselineStages } from "@tearleads/api-shared/schema";
import {
  extendDocumentBaselineSegmentsDigest,
  startDocumentBaselineSegmentsDigest,
} from "@tearleads/crypto";
import {
  decodeVersionVector,
  emptyVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import { createTestUser } from "@tearleads/test-utils";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import { DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE } from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  expectNothingWritten,
  peerRanges,
  signerFor,
} from "../../../test/helpers/baselineGroupRefusals";
import {
  documentWithHistory,
  type History,
  pullAsNewReader,
} from "../../../test/helpers/baselineGroupRouteKit";
import {
  abandonStage,
  getStage,
  openStage,
  putSegment,
  stagedRows,
} from "../../../test/helpers/baselineStageKit";
import {
  type BaselineSegmentRange,
  createSignedBaselineGroup,
} from "../../../test/helpers/documentBaselineGroups";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { registerUser } from "../../../test/helpers/registerUser";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
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

test("a writer stages a baseline's segments in order, and none is served", async () => {
  const history = await documentWithHistory();
  const { committed, created, frontier, owner } = history;
  const [first, second, final] = await currentSigner(history)({
    ranges: peerRanges(frontier),
  });
  if (!first || !second || !final) throw new Error("Expected three segments");
  const baselineId = first.baselineId ?? "";
  const stage = { baselineId, contentKeyEpoch: created.contentKeyEpoch };
  const start = await startDocumentBaselineSegmentsDigest({
    baselineId,
    documentId: created.id,
  });

  const opened = await stageStatus(await openStage(owner, created.id, stage));
  expect(opened).toMatchObject({
    baselineId,
    contentKeyEpoch: created.contentKeyEpoch,
    nextSegmentIndex: 0,
    segmentsDigest: start,
    stagedBytes: 0,
  });

  // Strictly in order: a later index names the one the stage expects.
  expect(
    await stageRefusal(await putSegment(owner, created.id, second)),
  ).toEqual({
    code: STAGE.segmentOutOfOrder,
    error: "Document baseline segment is not the stage's next",
    nextSegmentIndex: 0,
  });
  const header = readWriteHeader(first.writeHeader, "write header");
  const afterFirst = {
    nextSegmentIndex: 1,
    segmentsDigest: await extendDocumentBaselineSegmentsDigest(start, {
      ciphertextHash: header.ciphertextHash,
      metadataHash: header.metadataHash,
      segmentIndex: 0,
      updateId: first.id,
    }),
    // Everything the staged row keeps of the segment, not its ciphertext
    // alone.
    stagedBytes:
      first.encryptedData.length +
      first.partialStartVersionVector.length +
      first.partialEndVersionVector.length +
      first.dependencyVersionVector.length +
      first.plaintextHash.length +
      JSON.stringify(header).length,
  };
  expect(
    await stageStatus(await putSegment(owner, created.id, first)),
  ).toMatchObject(afterFirst);
  // The same index with the same ciphertext is acknowledged without a write.
  expect(
    await stageStatus(await putSegment(owner, created.id, first)),
  ).toMatchObject(afterFirst);
  expect((await stagedRows(created.id)).segments).toHaveLength(1);
  // Other bytes at a staged index are a conflict.
  const [other] = await currentSigner(history)({
    baselineId,
    ranges: peerRanges(frontier),
  });
  if (!other) throw new Error("Expected a segment");
  expect(
    (await stageRefusal(await putSegment(owner, created.id, other))).code,
  ).toBe(STAGE.segmentConflict);

  expect(
    (await stageStatus(await putSegment(owner, created.id, second)))
      .nextSegmentIndex,
  ).toBe(2);
  // The final segment travels with the request that commits the stage.
  expect(
    (await stageRefusal(await putSegment(owner, created.id, final))).code,
  ).toBe(STAGE.segmentInvalid);
  expect(
    await stageStatus(await getStage(owner, created.id, baselineId)),
  ).toMatchObject({ nextSegmentIndex: 2 });
  // Opening the same stage again keeps what it holds.
  expect(
    (await stageStatus(await openStage(owner, created.id, stage)))
      .nextSegmentIndex,
  ).toBe(2);

  // Nothing staged is an update of the document: a reader that holds
  // nothing is served the committed updates and no staged segment.
  await expectNothingWritten(history);
  const served = (
    await pullAsNewReader(owner, created.id, created, 64)
  ).flatMap((page) => page.updates.map((update) => update.id));
  expect(served).toEqual(committed.map((update) => update.id));

  expect(
    await stageStatus(await abandonStage(owner, created.id, baselineId)),
  ).toEqual({ baselineId });
  expect(await stagedRows(created.id)).toEqual({
    segments: [],
    spans: [],
    stages: [],
  });
  for (const gone of [
    await getStage(owner, created.id, baselineId),
    await abandonStage(owner, created.id, baselineId),
    await putSegment(owner, created.id, first),
  ]) {
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({
      code: STAGE.notFound,
      error: "Document baseline stage not found",
    });
  }
});

test("opening a stage replaces the caller's earlier one and refuses an id in use", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner } = history;
  const sign = currentSigner(history);
  const at = { contentKeyEpoch: created.contentKeyEpoch };
  const [earlier] = await sign({ ranges: peerRanges(frontier) });
  if (!earlier?.baselineId) throw new Error("Expected a segment");
  await stageStatus(
    await openStage(owner, created.id, {
      ...at,
      baselineId: earlier.baselineId,
    }),
  );
  await stageStatus(await putSegment(owner, created.id, earlier));

  // One open stage per user and document: a second open is a new stage, and
  // what the first one staged goes with it.
  const later = crypto.randomUUID();
  expect(
    (
      await stageStatus(
        await openStage(owner, created.id, { ...at, baselineId: later }),
      )
    ).nextSegmentIndex,
  ).toBe(0);
  expect(await stagedRows(created.id)).toEqual({
    segments: [],
    spans: [],
    stages: [{ id: later, nextSegmentIndex: 0 }],
  });
  await stageStatus(await abandonStage(owner, created.id, later));

  // An id another user's stage holds on this document.
  const taken = crypto.randomUUID();
  await db.insert(documentBaselineStages).values({
    contentKeyCommitment: "c".repeat(64),
    contentKeyEpoch: created.contentKeyEpoch,
    documentId: created.id,
    expiresAt: new Date(Date.now() + 60_000),
    id: taken,
    organizationId: crypto.randomUUID(),
    ownerUserId: crypto.randomUUID(),
    segmentsDigest: "0".repeat(64),
  });
  expect(
    await stageRefusal(
      await openStage(owner, created.id, { ...at, baselineId: taken }),
    ),
  ).toEqual({
    code: STAGE.idConflict,
    error: "Document baseline id is already in use",
  });
  // That stage is not this user's to read, write to or delete.
  for (const foreign of [
    await getStage(owner, created.id, taken),
    await abandonStage(owner, created.id, taken),
    await putSegment(owner, created.id, earlier, { baselineId: taken }),
  ]) {
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).code).toBe(STAGE.notFound);
  }

  // A stage for a key the document does not hold at that epoch.
  expect(
    (
      await stageRefusal(
        await openStage(owner, created.id, {
          ...at,
          baselineId: crypto.randomUUID(),
          contentKeyCommitment: "d".repeat(64),
        }),
      )
    ).code,
  ).toBe(STAGE.epochStale);

  // A user who cannot write the document opens nothing.
  const stranger = createTestUser();
  await registerUser(stranger);
  await authenticate(stranger);
  const refused = await openStage(stranger, created.id, {
    ...at,
    baselineId: crypto.randomUUID(),
  });
  expect(refused.status).toBe(403);
  expect((await stagedRows(created.id)).stages).toEqual([
    { id: taken, nextSegmentIndex: 0 },
  ]);
});

// A committed baseline's id is spent: its staged rows are its updates'
// payloads, and a stage under the same id would put them within reach of
// the deletes a stage ends by.
test("a baseline id the document committed cannot name a stage", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner, root } = history;
  const group = await currentSigner(history)({ ranges: peerRanges(frontier) });
  const baselineId = group[0]?.baselineId ?? "";
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
  expect(
    await stageRefusal(
      await openStage(owner, created.id, {
        baselineId,
        contentKeyEpoch: created.contentKeyEpoch,
      }),
    ),
  ).toEqual({
    code: STAGE.idConflict,
    error: "Document baseline id is already in use",
  });
  expect((await stagedRows(created.id)).stages).toEqual([]);
});

/** One peer's range of `frontier`, by position in canonical peer order. */
function rangeAt(frontier: string, position: number): BaselineSegmentRange {
  const range = peerRanges(frontier)[position];
  if (!range) throw new Error(`No peer ${position}`);
  return range;
}

function peerOf(range: BaselineSegmentRange): string {
  const [peer] = decodeVersionVector(range.partialEndVersionVector)
    .toJSON()
    .keys();
  if (peer === undefined) throw new Error("Expected a peer");
  return peer;
}

test("a staged segment is verified as an update is and walked against the stage", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner } = history;
  const sign = currentSigner(history);
  const baselineId = crypto.randomUUID();
  await stageStatus(
    await openStage(owner, created.id, {
      baselineId,
      contentKeyEpoch: created.contentKeyEpoch,
    }),
  );
  /** Signs `range` as the stage's first segment, not its final one. */
  const first = async (
    range: BaselineSegmentRange,
    signer = sign,
  ): Promise<DocumentOutgoingUpdate> => {
    const [segment] = await signer({
      baselineId,
      ranges: [range, rangeAt(frontier, 2)],
    });
    if (!segment) throw new Error("Expected a segment");
    return segment;
  };
  const honest = rangeAt(frontier, 0);
  const otherPeer = peerOf(rangeAt(frontier, 1));
  const invalid: [string, BaselineSegmentRange][] = [
    [
      "a span that does not start where the stage left its peer",
      {
        ...honest,
        dependencyVersionVector: emptyVersionVector(),
        partialStartVersionVector: encodeVersionVectorCounters({
          [peerOf(honest)]: 1,
        }),
        partialEndVersionVector: encodeVersionVectorCounters({
          [peerOf(honest)]: 2,
        }),
      },
    ],
    [
      "a dependency on an operation nothing staged carries",
      {
        ...honest,
        dependencyVersionVector: encodeVersionVectorCounters({
          [otherPeer]: 1,
        }),
      },
    ],
    [
      "a dependency that names a peer and no operation",
      {
        ...honest,
        dependencyVersionVector: encodeVersionVectorCounters({ "424242": 0 }),
      },
    ],
    [
      "a peer named at its end with no span",
      {
        dependencyVersionVector: emptyVersionVector(),
        partialEndVersionVector: frontier,
        partialStartVersionVector: encodeVersionVectorCounters(
          Object.fromEntries(
            [...decodeVersionVector(frontier).toJSON()].filter(
              ([peer]) => peer !== peerOf(honest),
            ),
          ),
        ),
      },
    ],
  ];
  for (const [name, range] of invalid) {
    const response = await putSegment(owner, created.id, await first(range));
    expect([name, response.status]).toEqual([name, 409]);
    expect([name, (await response.json()).code]).toEqual([
      name,
      STAGE.segmentInvalid,
    ]);
  }

  // A segment of another baseline sent to this stage.
  const [elsewhere] = await sign({ ranges: [honest, rangeAt(frontier, 2)] });
  if (!elsewhere) throw new Error("Expected a segment");
  expect(
    (
      await stageRefusal(
        await putSegment(owner, created.id, elsewhere, { baselineId }),
      )
    ).code,
  ).toBe(STAGE.segmentInvalid);

  // What its writer signed is checked when it is staged, not at the commit.
  const signed = await first(honest);
  const nextEpoch = signerFor(history, {
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch + 1,
    dependencyManifestHashes: [history.root.bundle.manifestHash],
    targetHash: created.targetHash,
  });
  const unsigned: [string, DocumentOutgoingUpdate, string][] = [
    [
      "ciphertext other than the signed hash",
      { ...signed, encryptedData: signed.encryptedData.replace("}", " }") },
      "Document update ciphertext hash mismatch",
    ],
    [
      "vectors other than the signed metadata",
      { ...signed, dependencyVersionVector: frontier },
      "Document update metadata hash mismatch",
    ],
    [
      "a header at another epoch",
      await first(honest, nextEpoch),
      "Write header does not match stage",
    ],
    [
      "no operations",
      await first({
        partialEndVersionVector: emptyVersionVector(),
        partialStartVersionVector: emptyVersionVector(),
      }),
      "Document update declares no operations",
    ],
    [
      "an envelope under another key than the stage's",
      await first(honest, (options) =>
        createSignedBaselineGroup({
          accessManifestHash: created.manifestHash,
          contentKeyCommitment: "d".repeat(64),
          contentKeyEpoch: created.contentKeyEpoch,
          dependencyManifestHashes: [history.root.bundle.manifestHash],
          documentId: created.id,
          organizationId: String(
            Reflect.get(created.accessManifest.state, "organizationId"),
          ),
          owner,
          targetHash: created.targetHash,
          ...options,
        }),
      ),
      "Document update envelope does not commit to its epoch's content key",
    ],
  ];
  for (const [name, segment, error] of unsigned) {
    const response = await putSegment(owner, created.id, segment);
    expect([name, response.status]).toEqual([name, 400]);
    expect(await response.json()).toEqual({ error });
  }

  expect(await stagedRows(created.id)).toEqual({
    segments: [],
    spans: [],
    stages: [{ id: baselineId, nextSegmentIndex: 0 }],
  });
  expect((await putSegment(owner, created.id, signed)).status).toBe(200);
});

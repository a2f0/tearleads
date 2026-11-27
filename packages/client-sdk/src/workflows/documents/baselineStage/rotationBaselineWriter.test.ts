// The baseline writer below the routes that use it: how much it holds while
// it cuts, where it cuts the final segment, what it checks before it relies
// on a stage, and the limit a staged baseline cannot pass.
import { expect, test } from "bun:test";
import {
  extendDocumentBaselineSegmentsDigest,
  startDocumentBaselineSegmentsDigest,
} from "@tearleads/crypto";
import {
  createDocument,
  exportFullHistorySnapshot,
  historySegmentsImportInOrder,
} from "@tearleads/loro";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import { MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS } from "@tearleads/validators/util";
import {
  appendHistory,
  createLongHistoryDocument,
} from "../../../../test/helpers/workflows/stagedBaselineHeal";
import type { DocumentBaselineStageApi } from "../../../data/documents/shared/sync/baselineStageApi";
import { openDocumentContentKey } from "../../../data/documents/shared/sync/contentKeyCommitment";
import { isDocumentSyncRequestLimitError } from "../../../data/documents/shared/sync/documentSyncOutgoingBatch";
import type { DocumentSyncPreparedUpdate } from "../../../data/documents/shared/sync/documentSyncTypes";
import {
  type EncodedBaselineSegment,
  ROTATION_BASELINE_FINAL_SEGMENT_TARGET_BYTES,
  stagedSegmentMatchesHistory,
  stagedSegmentRecord,
  startRotationBaselineEncoder,
} from "./rotationBaselineEncoder";
import { DocumentRotationBaselineLimitError } from "./rotationBaselineErrors";
import type { RotationBaselineSigner } from "./rotationBaselineSigner";
import { writeRotationBaseline } from "./rotationBaselineWriter";
import { openRotationHistory, type RotationHistory } from "./rotationHistory";

const documentId = "0b6d7e0e-3c5a-4d0f-9a51-7b1f5c2a9e10";
const organizationId = "3a1c2b4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const contentKey = crypto.getRandomValues(new Uint8Array(32));

async function keying() {
  return {
    contentKey: await openDocumentContentKey({
      contentKey,
      contentKeyEpoch: 2,
      documentId,
    }),
    contentKeyEpoch: 2,
    documentId,
    organizationId,
  };
}

type HistoryDocument = Awaited<ReturnType<typeof createDocument>>;

function historyOf(document: HistoryDocument): RotationHistory {
  return openRotationHistory({
    purpose: "Writer test",
    snapshot: exportFullHistorySnapshot(document),
  });
}

async function encodeAll(
  history: RotationHistory,
  options: { smallFinal: boolean; targetBytes?: number },
) {
  const { encoder } = await startRotationBaselineEncoder({
    coversThroughUpdateId: undefined,
    history,
    keying: await keying(),
    segmentSizes:
      options.targetBytes === undefined
        ? undefined
        : {
            maxBytes: 4 * options.targetBytes,
            targetBytes: options.targetBytes,
          },
  });
  const segments: EncodedBaselineSegment[] = [];
  for (;;) {
    const segment = await encoder.next({ smallFinal: options.smallFinal });
    if (!segment) return segments;
    segments.push(segment);
  }
}

test("the encoder exports at most two segments ahead of the one it encrypts", async () => {
  const history = historyOf(await createLongHistoryDocument("lookahead", 60));
  let exported = 0;
  const counted: RotationHistory = {
    ...history,
    segments: function* (sizes, after) {
      for (const segment of history.segments(sizes, after)) {
        exported += 1;
        yield segment;
      }
    },
  };
  const { encoder } = await startRotationBaselineEncoder({
    coversThroughUpdateId: undefined,
    history: counted,
    keying: await keying(),
    segmentSizes: { maxBytes: 1024, targetBytes: 256 },
  });
  // Nothing is cut until a segment is asked for.
  expect(exported).toBe(0);
  let encrypted = 0;
  while (await encoder.next({ smallFinal: false })) {
    encrypted += 1;
    expect(exported - encrypted).toBeLessThanOrEqual(2);
  }
  expect(encrypted).toBeGreaterThan(20);
  expect(exported).toBe(encrypted);
  history.free();
});

test("a staged baseline's last segment is cut again so that its final one is small", async () => {
  const document = await createDocument("small-final");
  const bytes = new Uint8Array(3 * 1024 * 1024);
  for (let offset = 0; offset < bytes.length; offset += 65_536) {
    crypto.getRandomValues(bytes.subarray(offset, offset + 65_536));
  }
  document.getText("text").insert(0, bytes.toBase64());
  document.commit();
  const history = historyOf(document);

  // Sent whole, the history is one segment, as it always was.
  const whole = await encodeAll(history, { smallFinal: false });
  expect(whole.map((segment) => segment.final)).toEqual([true]);

  const staged = await encodeAll(history, { smallFinal: true });
  expect(staged.length).toBeGreaterThan(2);
  expect(staged.map((segment) => segment.final)).toEqual([
    ...staged.slice(1).map(() => false),
    true,
  ]);
  const final = staged.at(-1)?.prepared;
  expect(final?.baselineSegmentCount).toBe(staged.length);
  // Base64 inside the envelope: about four thirds of the plaintext target.
  expect(final?.encryptedData.length).toBeLessThan(
    2 * ROTATION_BASELINE_FINAL_SEGMENT_TARGET_BYTES,
  );
  expect(
    historySegmentsImportInOrder(staged.map((segment) => segment.prepared)),
  ).toBe(true);
  history.free();
});

test("a staged segment matches only a history that still gives its bytes", async () => {
  const document = await createLongHistoryDocument("matches", 30);
  const history = historyOf(document);
  const [first] = await encodeAll(history, {
    smallFinal: false,
    targetBytes: 256,
  });
  if (!first) throw new Error("Expected a segment");
  const record = stagedSegmentRecord(first);
  const check = async (against: RotationHistory) =>
    stagedSegmentMatchesHistory({
      history: against,
      keying: await keying(),
      record,
    });

  expect(await check(history)).toBe(true);
  // The history a writer proves again, longer, still gives the segment.
  appendHistory(document, 4);
  const grown = historyOf(document);
  expect(await check(grown)).toBe(true);
  // Another document's history holds none of it.
  const other = historyOf(await createLongHistoryDocument("matches-other", 30));
  expect(await check(other)).toBe(false);
  // Nor does a record whose bytes are not the history's.
  expect(
    await stagedSegmentMatchesHistory({
      history,
      keying: await keying(),
      record: { ...record, plaintextHash: "0".repeat(64) },
    }),
  ).toBe(false);
  for (const opened of [history, grown, other]) opened.free();
});

/** A stage API that accepts everything and only counts and chains. */
function countingStageApi() {
  const calls = { abandon: 0, open: 0, stage: 0 };
  let digest = "";
  let next = 0;
  const status = (baselineId: string) => ({
    data: {
      baselineId,
      contentKeyCommitment: "",
      contentKeyEpoch: 2,
      expiresAt: "2026-07-26T01:00:00.000Z",
      nextSegmentIndex: next,
      segmentsDigest: digest,
      stagedBytes: 0,
    },
    ok: true as const,
  });
  const api: DocumentBaselineStageApi = {
    abandonDocumentBaselineStageResult: async (_documentId, baselineId) => {
      calls.abandon += 1;
      return { data: { baselineId }, ok: true };
    },
    getDocumentBaselineStageResult: async (_documentId, baselineId) =>
      status(baselineId),
    openDocumentBaselineStageResult: async (_documentId, input) => {
      calls.open += 1;
      digest = await startDocumentBaselineSegmentsDigest({
        baselineId: input.baselineId,
        documentId,
      });
      return status(input.baselineId);
    },
    resignDocumentBaselineSegmentHeaderResult: async (_documentId, id) =>
      status(id),
    stageDocumentBaselineSegmentResult: async (
      _documentId,
      baselineId,
      segmentIndex,
      segment,
    ) => {
      calls.stage += 1;
      next = segmentIndex + 1;
      digest = await extendDocumentBaselineSegmentsDigest(digest, {
        ciphertextHash: String(
          Reflect.get(segment.writeHeader, "ciphertextHash"),
        ),
        metadataHash: String(Reflect.get(segment.writeHeader, "metadataHash")),
        segmentIndex,
        updateId: segment.id,
      });
      return status(baselineId);
    },
  };
  return { api, calls };
}

/** Signs nothing: the header carries only what the counting API chains. */
const unsigned: RotationBaselineSigner = {
  identity: "unsigned",
  sign: async (
    update: DocumentSyncPreparedUpdate,
  ): Promise<DocumentOutgoingUpdate> => ({
    dependencyVersionVector: update.dependencyVersionVector,
    encryptedData: update.encryptedData,
    id: update.id,
    partialEndVersionVector: update.partialEndVersionVector,
    partialStartVersionVector: update.partialStartVersionVector,
    plaintextHash: update.plaintextHash,
    writeHeader: {
      ciphertextHash: update.ciphertextHash,
      metadataHash: update.metadataHash,
    },
  }),
};

// One counter a segment: the smallest a segment can be, so a history of
// more counters than a staged baseline has places cannot be staged.
test("a history that needs more than 4,096 segments fails with the named limit", async () => {
  const document = await createDocument("segment-limit");
  document
    .getText("text")
    .insert(0, "x".repeat(MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS + 8));
  document.commit();
  const { api, calls } = countingStageApi();

  const failure = await writeRotationBaseline({
    api,
    contentKey,
    contentKeyEpoch: 2,
    documentId,
    execSql: undefined,
    inlineCharacters: 16 * 1024 * 1024,
    keyTargets: [],
    organizationId,
    plan: { linkSetEvent: undefined, signedAt: "2026-07-26T00:00:00.000Z" },
    purpose: "Writer test",
    segmentSizes: { maxBytes: 4096, targetBytes: 1 },
    signer: unsigned,
    snapshot: exportFullHistorySnapshot(document),
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(DocumentRotationBaselineLimitError);
  // A request-limit error: a heal ends in `document_sync_request_too_large`.
  expect(isDocumentSyncRequestLimitError(failure)).toBe(true);
  expect(String(failure)).toContain(
    "Document rotation baseline needs more than 4096 segments",
  );
  // Index 4,095 is the final segment's: the stage holds 4,095 at most.
  expect(calls).toEqual({
    abandon: 1,
    open: 1,
    stage: MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS - 1,
  });
}, 120_000);

test("a history of exactly 4,096 segments is staged whole", async () => {
  const document = await createDocument("segment-limit-fits");
  document
    .getText("text")
    .insert(0, "x".repeat(MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS));
  document.commit();
  const { api, calls } = countingStageApi();

  const baseline = await writeRotationBaseline({
    api,
    contentKey,
    contentKeyEpoch: 2,
    documentId,
    execSql: undefined,
    inlineCharacters: 16 * 1024 * 1024,
    keyTargets: [],
    organizationId,
    plan: { linkSetEvent: undefined, signedAt: "2026-07-26T00:00:00.000Z" },
    purpose: "Writer test",
    segmentSizes: { maxBytes: 4096, targetBytes: 1 },
    signer: unsigned,
    snapshot: exportFullHistorySnapshot(document),
  });

  if (baseline.kind !== "staged") throw new Error("Expected a staged baseline");
  const [final] = baseline.segments;
  expect(final.baselineSegmentIndex).toBe(
    MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS - 1,
  );
  expect(final.baselineSegmentCount).toBe(
    MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS,
  );
  expect(calls.stage).toBe(MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS - 1);
  expect(calls.abandon).toBe(0);
}, 120_000);

// A write header is stored with its segment and served with it. What a
// stage stores of one counts against the stage's byte bound however it got
// there, staged with its segment or signed again later, and a header's own
// size is bounded where headers are parsed and where their requests arrive.
import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentBaselineSegments,
  documentBaselineStages,
} from "@tearleads/api-shared/schema";
import { signWriteHeader } from "@tearleads/crypto";
import { DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE } from "@tearleads/validators/response";
import {
  MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES,
  MAX_DOCUMENT_BASELINE_SEGMENT_REQUEST_BYTES,
  MAX_DOCUMENT_BASELINE_STAGE_BYTES,
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS,
  MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH,
} from "@tearleads/validators/util";
import { eq } from "drizzle-orm";
import {
  expectNothingWritten,
  peerRanges,
  signerFor,
} from "../../../test/helpers/baselineGroupRefusals";
import { documentWithHistory } from "../../../test/helpers/baselineGroupRouteKit";
import {
  openStage,
  putSegment,
  putSegmentHeader,
} from "../../../test/helpers/baselineStageKit";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { readWriteHeader } from "../../workflows/documents/mutations/shared/records";

/** A stage with its first segment staged, and a signer of new headers for it. */
async function stagedFirstSegment() {
  const history = await documentWithHistory();
  const { created, frontier, owner, root } = history;
  const [first, second] = await signerFor(history, {
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch,
    dependencyManifestHashes: [root.bundle.manifestHash],
    targetHash: created.targetHash,
  })({ ranges: peerRanges(frontier) });
  if (!first?.baselineId || !second) throw new Error("Expected segments");
  const baselineId = first.baselineId;
  expect(
    (
      await openStage(owner, created.id, {
        baselineId,
        contentKeyEpoch: created.contentKeyEpoch,
      })
    ).status,
  ).toBe(200);
  const staged = await putSegment(owner, created.id, first);
  expect(staged.status).toBe(200);
  const { signature: _, ...unsigned } = readWriteHeader(
    first.writeHeader,
    "write header",
  );
  const sign = (changes: Partial<typeof unsigned>) =>
    signWriteHeader(
      { ...unsigned, ...changes },
      owner.signing.signingPrivateKey,
    );
  const resign = (writeHeader: unknown) =>
    putSegmentHeader(owner, created.id, baselineId, 0, writeHeader);
  const stageRow = async () => {
    const [row] = await db
      .select()
      .from(documentBaselineStages)
      .where(eq(documentBaselineStages.id, baselineId));
    if (!row) throw new Error("Expected the stage");
    return row;
  };
  const heldHeaderHash = async () =>
    (
      await db
        .select({ headerHash: documentBaselineSegments.headerHash })
        .from(documentBaselineSegments)
        .where(eq(documentBaselineSegments.updateId, first.id))
    )[0]?.headerHash;
  return {
    baselineId,
    first,
    heldHeaderHash,
    history,
    resign,
    second,
    sign,
    stagedBytes: Number((await staged.json()).stagedBytes),
    stageRow,
    unsigned,
  };
}

/** `count` distinct manifest hashes, in the order a header must cite them. */
function citations(count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    index.toString(16).padStart(64, "0"),
  );
}

const headerBytes = (header: unknown) =>
  Buffer.byteLength(JSON.stringify(readWriteHeader(header, "header")), "utf8");

// A stage's byte count holds every header it stores. Signing one again with
// a larger header moves the count by the difference, and is refused when the
// stage would pass its bound, as the segment itself would have been.
test("a header signed again is weighed against the stage's byte bound", async () => {
  const { first, heldHeaderHash, resign, sign, stagedBytes, stageRow } =
    await stagedFirstSegment();
  const larger = await sign({ dependencyManifestHashes: citations(40) });
  const added = headerBytes(larger) - headerBytes(first.writeHeader);
  expect(added).toBeGreaterThan(2000);

  const grown = await resign(larger);
  expect(grown.status).toBe(200);
  expect((await grown.json()).stagedBytes).toBe(stagedBytes + added);
  // Signed again with the header it had, the stage counts what it did.
  const shrunk = await resign(first.writeHeader);
  expect(shrunk.status).toBe(200);
  expect((await shrunk.json()).stagedBytes).toBe(stagedBytes);
  expect((await stageRow()).stagedBytes).toBe(stagedBytes);

  // One byte short of the bound: the larger header does not fit, and the
  // stage and the header it holds are as they were.
  await db
    .update(documentBaselineStages)
    .set({ stagedBytes: MAX_DOCUMENT_BASELINE_STAGE_BYTES - 1 })
    .where(eq(documentBaselineStages.id, first.baselineId ?? ""));
  const before = await stageRow();
  const held = await heldHeaderHash();
  const refused = await resign(larger);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({
    code: STAGE.tooLarge,
    error: "Document baseline stage would exceed its byte cap",
  });
  expect(await stageRow()).toEqual(before);
  expect(await heldHeaderHash()).toBe(held);
  // A header of the same size still fits.
  const moved = await resign(
    await sign({ accessManifestHash: "e".repeat(64) }),
  );
  expect(moved.status).toBe(200);
  expect((await moved.json()).stagedBytes).toBe(
    MAX_DOCUMENT_BASELINE_STAGE_BYTES - 1,
  );
  expect(await heldHeaderHash()).not.toBe(held);
});

// A document header cites at most the container manifests a document's
// authorization can name, and names a device in a bounded string. The parser
// every write goes through holds both, so a header is bounded before
// anything checks its authorization, which staging cannot.
test("a header's citations and device id are bounded where it is parsed", async () => {
  const { first, heldHeaderHash, resign, second, sign, history } =
    await stagedFirstSegment();
  const { created, owner, root } = history;
  const held = await heldHeaderHash();
  const most = citations(MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS);
  const longest = "\u20ac".repeat(MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH);

  // The largest header the parser admits fits a re-sign request.
  const widest = await sign({
    dependencyManifestHashes: most,
    writerDeviceId: longest,
  });
  expect(
    Buffer.byteLength(JSON.stringify({ writeHeader: widest }), "utf8"),
  ).toBeLessThan(MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES);
  expect((await resign(widest)).status).toBe(200);
  expect((await resign(first.writeHeader)).status).toBe(200);

  // The signer holds a header to the same bounds, so a header past one is
  // sent here under the signature it had: the parser refuses it for its
  // shape before any signature is read.
  const TOO_MANY = `write header dependencyManifestHashes may cite at most ${MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS} container manifests`;
  const TOO_LONG = `write header.writerDeviceId may be at most ${MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH} characters`;
  const pastBounds = (header: Record<string, unknown>) =>
    [
      [
        {
          ...header,
          dependencyManifestHashes: [...most, "f".repeat(64)],
        },
        TOO_MANY,
        400,
      ],
      [{ ...header, writerDeviceId: `${longest}x` }, TOO_LONG, 400],
      // A signature is canonical base64: the decoder forgives whitespace,
      // which must not let a header that verifies carry any amount of it.
      [
        {
          ...header,
          signature: `${String(Reflect.get(header, "signature"))}\n`,
        },
        "write header signature invalid",
        403,
      ],
    ] as const;
  const expectRefused = async (
    response: Response,
    reason: string,
    status: number,
  ) => {
    const body = await response.json();
    expect([response.status, String(body.error)]).toEqual([status, reason]);
  };
  for (const [header, reason, status] of pastBounds(first.writeHeader)) {
    await expectRefused(await resign(header), reason, status);
  }
  expect(await heldHeaderHash()).toBe(held);

  // The same headers on the segment that stages them, and on an ordinary
  // write, are refused by the same parser.
  for (const [writeHeader, reason, status] of pastBounds(second.writeHeader)) {
    await expectRefused(
      await putSegment(owner, created.id, { ...second, writeHeader }),
      reason,
      status,
    );
  }
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const [update] = request.outgoingUpdates;
  if (!update) throw new Error("Expected an update");
  for (const [writeHeader, reason, status] of pastBounds(update.writeHeader)) {
    await expectRefused(
      await postDocumentSync(owner, created.id, {
        ...request,
        outgoingUpdates: [{ ...update, writeHeader }],
      }),
      reason,
      status,
    );
  }
  await expectNothingWritten(history);
  // The honest segment and the honest write are still accepted.
  expect((await putSegment(owner, created.id, second)).status).toBe(200);
  expect((await postDocumentSync(owner, created.id, request)).status).toBe(200);
});

// One staged segment is one update's request, and a re-signed header is one
// header's: each route refuses a larger body before it parses it.
test("an oversize staged segment or re-signed header is refused with 413", async () => {
  const { first, heldHeaderHash, history, resign, second, stageRow } =
    await stagedFirstSegment();
  const { created, owner } = history;
  const before = await stageRow();
  const held = await heldHeaderHash();

  const segment = await putSegment(owner, created.id, {
    ...second,
    encryptedData: "A".repeat(MAX_DOCUMENT_BASELINE_SEGMENT_REQUEST_BYTES),
  });
  expect(segment.status).toBe(413);
  expect(await segment.json()).toEqual({ error: "Request body too large" });

  const header = await resign({
    ...first.writeHeader,
    writerDeviceId: "d".repeat(
      MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES,
    ),
  });
  expect(header.status).toBe(413);
  expect(await header.json()).toEqual({ error: "Request body too large" });
  // A body under the limit is read, and refused for what it says.
  const underLimit = await resign({
    ...first.writeHeader,
    writerDeviceId: "d".repeat(
      MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES / 2,
    ),
  });
  expect(underLimit.status).toBe(400);

  expect(await stageRow()).toEqual(before);
  expect(await heldHeaderHash()).toBe(held);
});

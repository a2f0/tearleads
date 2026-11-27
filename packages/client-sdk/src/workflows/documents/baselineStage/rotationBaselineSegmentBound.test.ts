// A baseline segment is one update, and the API takes no update that
// serializes to more than a sync request holds: as a staged segment's
// request, or as a segment an unlink carries inline. The writer cuts at a
// cap that leaves a segment room for what it is sent with, and refuses,
// before it sends anything, a segment that is still over.
import { expect, test } from "bun:test";
import {
  createDocument,
  DEFAULT_HISTORY_SEGMENT_MAX_BYTES,
  DEFAULT_HISTORY_SEGMENT_TARGET_BYTES,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import {
  MAX_DOCUMENT_BASELINE_SEGMENT_REQUEST_BYTES,
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
} from "@tearleads/validators/util";
import {
  createAuthor,
  fixtureHash,
} from "../../../../test/helpers/data/documentFixtures";
import { FakeBaselineStageServer } from "../../../../test/helpers/workflows/fakeBaselineStageServer";
import { createLongHistoryDocument } from "../../../../test/helpers/workflows/stagedBaselineHeal";
import { openDocumentContentKey } from "../../../data/documents/shared/sync/contentKeyCommitment";
import {
  isDocumentSyncRequestLimitError,
  serializedBytes,
} from "../../../data/documents/shared/sync/documentSyncOutgoingBatch";
import { buildDocumentRotationBaseline } from "../rotationBaseline";
import { startRotationBaselineEncoder } from "./rotationBaselineEncoder";
import { DocumentRotationBaselineLimitError } from "./rotationBaselineErrors";
import { rotationBaselineSigner } from "./rotationBaselineSigner";
import { writeRotationBaseline } from "./rotationBaselineWriter";
import { openRotationHistory } from "./rotationHistory";

const MEBIBYTE = 1024 * 1024;
const documentId = "0b6d7e0e-3c5a-4d0f-9a51-7b1f5c2a9e10";
const contentKey = crypto.getRandomValues(new Uint8Array(32));

/** Text of `characters` characters that no encoding makes smaller. */
function incompressibleText(characters: number): string {
  const bytes = new Uint8Array(Math.ceil((characters * 3) / 4));
  for (let offset = 0; offset < bytes.length; offset += 65_536) {
    crypto.getRandomValues(bytes.subarray(offset, offset + 65_536));
  }
  return bytes.toBase64().slice(0, characters);
}

async function signingContext() {
  const { author } = await createAuthor();
  return {
    author,
    authorizingContainerPathRefs: [],
    contentKeyEpoch: 2,
    documentId,
    expectedLinkSetManifestHash: await fixtureHash("bound-manifest"),
    expectedTargetHash: await fixtureHash("bound-target"),
    organizationId: author.organizationId,
    signedAt: "2026-07-26T00:00:00.000Z",
  };
}

test("the cap and both request bounds are the numbers the docs give", () => {
  expect(DEFAULT_HISTORY_SEGMENT_MAX_BYTES).toBe(11 * MEBIBYTE);
  expect(MAX_DOCUMENT_SYNC_REQUEST_BYTES).toBe(16 * MEBIBYTE);
  expect(MAX_DOCUMENT_BASELINE_SEGMENT_REQUEST_BYTES).toBe(16 * MEBIBYTE);
});

// One map value is one operation, which no cut divides: the largest
// segment the writer can make. Encrypted and signed as an unlink sends it,
// it is within the 16 MiB the API holds a segment to, with over a mebibyte
// to spare for the vectors and header of a document of many peers and
// links.
test("a segment at the cap fits one request, signed, with room to spare", async () => {
  const document = await createDocument("segment-at-the-cap");
  document
    .getMap("fields")
    .set(
      "value",
      incompressibleText(DEFAULT_HISTORY_SEGMENT_MAX_BYTES - 64 * 1024),
    );
  document.commit();
  const snapshot = exportFullHistorySnapshot(document);
  const history = openRotationHistory({ purpose: "Bound test", snapshot });
  try {
    const [plaintext, ...rest] = [...history.segments({}, undefined)];
    expect(rest).toEqual([]);
    expect(plaintext?.update.byteLength).toBeGreaterThan(
      DEFAULT_HISTORY_SEGMENT_MAX_BYTES - 128 * 1024,
    );
    expect(plaintext?.update.byteLength).toBeLessThanOrEqual(
      DEFAULT_HISTORY_SEGMENT_MAX_BYTES,
    );
  } finally {
    history.free();
  }

  const baseline = await buildDocumentRotationBaseline({
    ...(await signingContext()),
    contentKey,
    execSql: async () => [],
    snapshot,
  });

  if (!baseline || baseline === "cancelled") throw new Error("No baseline");
  expect(baseline.staged).toBeNull();
  expect(baseline.segments).toHaveLength(1);
  const [segment] = baseline.segments;
  const bytes = serializedBytes(segment);
  expect(bytes).toBeLessThanOrEqual(MAX_DOCUMENT_SYNC_REQUEST_BYTES);
  expect(MAX_DOCUMENT_SYNC_REQUEST_BYTES - bytes).toBeGreaterThan(MEBIBYTE);
  // No string of it is near the bound each string is held to either.
  expect(segment?.encryptedData.length).toBeLessThan(15 * MEBIBYTE);
}, 120_000);

test("one operation over the cap is never cut into a segment", async () => {
  const document = await createDocument("operation-over-the-cap");
  document
    .getMap("fields")
    .set(
      "value",
      incompressibleText(DEFAULT_HISTORY_SEGMENT_MAX_BYTES + 64 * 1024),
    );
  document.commit();

  const failure = await buildDocumentRotationBaseline({
    ...(await signingContext()),
    contentKey,
    execSql: async () => [],
    snapshot: exportFullHistorySnapshot(document),
  }).catch((error: unknown) => error);

  expect(isDocumentSyncRequestLimitError(failure)).toBe(true);
  expect(String(failure)).toContain("cannot carry one operation");
}, 120_000);

// A caller chooses its segment sizes (tests cut small). No choice cuts a
// segment over the cap: the sizes are held to it.
test("sizes a caller passes never cut a segment over the cap", async () => {
  const document = await createDocument("caller-sizes");
  document
    .getText("text")
    .insert(
      0,
      incompressibleText(DEFAULT_HISTORY_SEGMENT_MAX_BYTES + MEBIBYTE),
    );
  document.commit();
  const history = openRotationHistory({
    purpose: "Bound test",
    snapshot: exportFullHistorySnapshot(document),
  });
  try {
    const { encoder } = await startRotationBaselineEncoder({
      coversThroughUpdateId: undefined,
      history,
      keying: {
        contentKey: await openDocumentContentKey({
          contentKey,
          contentKeyEpoch: 2,
          documentId,
        }),
        contentKeyEpoch: 2,
        documentId,
        organizationId: "organization-1",
      },
      segmentSizes: { maxBytes: 64 * MEBIBYTE, targetBytes: 32 * MEBIBYTE },
    });

    const first = encoder.peek();

    expect(first?.final).toBe(false);
    expect(first?.bytes).toBeLessThanOrEqual(DEFAULT_HISTORY_SEGMENT_MAX_BYTES);
    // Larger than the usual target all the same: the caller's sizes count.
    expect(first?.bytes).toBeGreaterThan(DEFAULT_HISTORY_SEGMENT_TARGET_BYTES);
  } finally {
    history.free();
  }
}, 120_000);

// The cap leaves room, not a proof: a document of very many peers has
// vectors of any size. A segment that is over the bound once it is signed
// is refused where it is signed, with the limit's name.
test("a signed segment over a request's bytes is refused before it is sent", async () => {
  const signer = rotationBaselineSigner(await signingContext());
  const prepared = (encryptedData: string) => ({
    ciphertextHash: "c".repeat(64),
    contentRecordId: crypto.randomUUID(),
    dependencyVersionVector: "AA==",
    encryptedData,
    id: crypto.randomUUID(),
    metadataHash: "d".repeat(64),
    partialEndVersionVector: "AA==",
    partialStartVersionVector: "AA==",
    plaintextHash: "e".repeat(64),
  });
  const overhead = serializedBytes(await signer.sign(prepared("")));
  const room = MAX_DOCUMENT_SYNC_REQUEST_BYTES - overhead;

  const fits = await signer.sign(prepared("A".repeat(room)));
  expect(serializedBytes(fits)).toBe(MAX_DOCUMENT_SYNC_REQUEST_BYTES);

  const failure = await signer
    .sign(prepared("A".repeat(room + 1)))
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DocumentRotationBaselineLimitError);
  expect(isDocumentSyncRequestLimitError(failure)).toBe(true);
  expect(String(failure)).toContain(
    "has a segment that is over the 16777216 bytes of one request",
  );
});

// A staged upload that meets such a segment is over: its stage is deleted,
// so it does not hold one of the user's open stages until it expires.
test("a staged segment that is refused for its size deletes the stage", async () => {
  const context = await signingContext();
  const signer = rotationBaselineSigner(context);
  const server = new FakeBaselineStageServer();
  const document = await createLongHistoryDocument("staged-segment-too-large");
  let signedSegments = 0;

  const failure = await writeRotationBaseline({
    api: server.api,
    contentKey,
    contentKeyEpoch: 2,
    documentId,
    execSql: undefined,
    inlineCharacters: 0,
    organizationId: context.organizationId,
    plan: { linkSetEvent: undefined, signedAt: context.signedAt },
    purpose: "Bound test",
    segmentSizes: { maxBytes: 1024, targetBytes: 256 },
    signer: {
      identity: signer.identity,
      sign: (update) => {
        signedSegments += 1;
        return signer.sign(
          signedSegments === 3
            ? { ...update, plaintextHash: "A".repeat(16 * MEBIBYTE) }
            : update,
        );
      },
    },
    snapshot: exportFullHistorySnapshot(document),
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(DocumentRotationBaselineLimitError);
  expect(server.calls).toEqual(["open", "stage:0", "stage:1", "abandon"]);
  expect(server.stage(documentId)).toBeNull();
});

import { expect, test } from "bun:test";
import { computeDocumentContentRecordMetadataHash } from "@tearleads/crypto";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
} from "@tearleads/loro";
import {
  authenticateSyncUpdateMetadataForResponse,
  authorizationTargetsUnlessHeld,
  materializeSyncResponseEntriesToBytes,
} from "./syncResponseUpdates";

/** A stored row's signed columns: an ordinary update, with no group fields. */
async function storedUpdateFixture() {
  const document = await createDocument("sync-response-metadata-test");
  document.getText("text").update("stored state");
  document.commit();
  return {
    baselineCoversThroughUpdateId: null,
    baselineId: null,
    baselineSegmentCount: null,
    baselineSegmentIndex: null,
    baselineSegmentsDigest: null,
    dependencyVersionVector: emptyVersionVector(),
    documentId: crypto.randomUUID(),
    id: crypto.randomUUID(),
    partialEndVersionVector: encodeVersionVector(document),
    partialStartVersionVector: emptyVersionVector(),
    plaintextHash: "sync-response-plaintext-hash",
  };
}

type StoredUpdateFixture = Awaited<ReturnType<typeof storedUpdateFixture>>;

/** The row as the final segment of a two-segment baseline with a cursor. */
function asFinalSegment(row: StoredUpdateFixture) {
  return {
    ...row,
    baselineCoversThroughUpdateId: crypto.randomUUID(),
    baselineId: crypto.randomUUID(),
    baselineSegmentCount: 2,
    baselineSegmentIndex: 1,
    baselineSegmentsDigest: "ab".repeat(32),
  };
}

type StoredSegmentFixture = ReturnType<typeof asFinalSegment>;

function signedMetadataHash(row: StoredUpdateFixture | StoredSegmentFixture) {
  return computeDocumentContentRecordMetadataHash({
    ...(row.baselineId === null
      ? {}
      : {
          baselineId: row.baselineId,
          baselineSegmentCount: row.baselineSegmentCount ?? undefined,
          baselineSegmentIndex: row.baselineSegmentIndex ?? undefined,
          baselineSegmentsDigest: row.baselineSegmentsDigest ?? undefined,
          coversThroughUpdateId: row.baselineCoversThroughUpdateId ?? undefined,
        }),
    dependencyVersionVector: row.dependencyVersionVector,
    documentId: row.documentId,
    partialEndVersionVector: row.partialEndVersionVector,
    partialStartVersionVector: row.partialStartVersionVector,
    plaintextHash: row.plaintextHash,
    updateId: row.id,
  });
}

const INTEGRITY_FAILURE = {
  message: "Document update metadata failed integrity validation",
  status: 409,
};

test("authenticates an update's signed metadata and returns its baseline fields", async () => {
  const ordinary = await storedUpdateFixture();
  await expect(
    authenticateSyncUpdateMetadataForResponse(
      ordinary,
      await signedMetadataHash(ordinary),
    ),
  ).resolves.toEqual({});

  const segment = asFinalSegment(ordinary);
  await expect(
    authenticateSyncUpdateMetadataForResponse(
      segment,
      await signedMetadataHash(segment),
    ),
  ).resolves.toEqual({
    baselineId: segment.baselineId,
    baselineSegmentCount: 2,
    baselineSegmentIndex: 1,
    baselineSegmentsDigest: segment.baselineSegmentsDigest,
    coversThroughUpdateId: segment.baselineCoversThroughUpdateId,
  });
});

test("fails closed when a baseline segment's row lost its group fields", async () => {
  const ordinary = await storedUpdateFixture();
  const segment = asFinalSegment(ordinary);
  // The header signs the segment; the row now reads as an ordinary update.
  await expect(
    authenticateSyncUpdateMetadataForResponse(
      ordinary,
      await signedMetadataHash(segment),
    ),
  ).rejects.toMatchObject(INTEGRITY_FAILURE);
});

test("fails closed when an ordinary update's row gained group fields", async () => {
  const ordinary = await storedUpdateFixture();
  await expect(
    authenticateSyncUpdateMetadataForResponse(
      asFinalSegment(ordinary),
      await signedMetadataHash(ordinary),
    ),
  ).rejects.toMatchObject(INTEGRITY_FAILURE);
});

test("fails closed when any stored group field differs from the signed one", async () => {
  const segment = asFinalSegment(await storedUpdateFixture());
  const metadataHash = await signedMetadataHash(segment);
  for (const changed of [
    { baselineId: crypto.randomUUID() },
    { baselineSegmentIndex: 0 },
    { baselineSegmentCount: 3 },
    { baselineSegmentCount: null },
    { baselineSegmentsDigest: "cd".repeat(32) },
    { baselineCoversThroughUpdateId: crypto.randomUUID() },
    { baselineCoversThroughUpdateId: null },
  ]) {
    await expect(
      authenticateSyncUpdateMetadataForResponse(
        { ...segment, ...changed },
        metadataHash,
      ),
    ).rejects.toMatchObject(INTEGRITY_FAILURE);
  }
});

test("fails closed when the stored plaintext hash differs from signed metadata", async () => {
  const ordinary = await storedUpdateFixture();
  for (const row of [ordinary, asFinalSegment(ordinary)]) {
    await expect(
      authenticateSyncUpdateMetadataForResponse(
        { ...row, plaintextHash: "tampered-plaintext-hash" },
        await signedMetadataHash(row),
      ),
    ).rejects.toMatchObject(INTEGRITY_FAILURE);
  }
});

test("fails closed when the signed metadata hash is not the row's", async () => {
  await expect(
    authenticateSyncUpdateMetadataForResponse(
      await storedUpdateFixture(),
      "tampered-metadata-hash",
    ),
  ).rejects.toMatchObject(INTEGRITY_FAILURE);
});

test("serialized response byte trimming preserves the next unserved sequence", async () => {
  const entries = [
    { sequence: 7, update: { encryptedData: "first", id: "first" } },
    { sequence: 11, update: { encryptedData: "second", id: "second" } },
  ];
  const firstItemBytes = new TextEncoder().encode(
    JSON.stringify([entries[0]?.update]),
  ).byteLength;

  expect(
    await materializeSyncResponseEntriesToBytes(
      entries,
      async (entry) => entry,
      firstItemBytes,
    ),
  ).toEqual(entries.slice(0, 1));
});

test("a large history is served in pages that fit the default byte budget", async () => {
  // Each update carries just under 8 MiB; the 32 MiB default budget admits
  // four of them and stops before the fifth without materializing beyond it.
  const payload = "x".repeat(8 * 1024 * 1024 - 1024);
  const materialized: number[] = [];
  const entries = await materializeSyncResponseEntriesToBytes(
    [1, 2, 3, 4, 5, 6],
    async (sequence) => {
      materialized.push(sequence);
      return {
        sequence,
        update: { encryptedData: payload, id: `update-${sequence}` },
      };
    },
  );
  expect(entries.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4]);
  expect(materialized).toEqual([1, 2, 3, 4, 5]);
});

test("metadata entries materialize only through the first byte overflow", async () => {
  const loaded: number[] = [];
  const first = { sequence: 1, update: { id: "first" } };
  const firstItemBytes = new TextEncoder().encode(
    JSON.stringify([first.update]),
  ).byteLength;

  const entries = await materializeSyncResponseEntriesToBytes(
    [1, 2, 3],
    async (sequence) => {
      loaded.push(sequence);
      return sequence === 1
        ? first
        : {
            sequence,
            update: {
              authorizationTargets: [
                { wrappedKey: "x".repeat(firstItemBytes) },
              ],
              id: `update-${sequence}`,
            },
          };
    },
    firstItemBytes,
  );

  expect(entries).toEqual([first]);
  expect(loaded).toEqual([1, 2]);
});

test("an update omits the target set the client holds and carries any other", () => {
  const authorizationTargets = [
    {
      containerId: "container",
      containerKeyEpoch: 1,
      containerKeyEpochId: "container-epoch",
      containerManifestHash: "container-manifest",
    },
  ];
  const writeHeader = (targetHash: string) => ({
    authorizationTargets,
    header: { targetHash } as Parameters<
      typeof authorizationTargetsUnlessHeld
    >[0]["header"],
  });
  expect(authorizationTargetsUnlessHeld(writeHeader("held"), "held")).toEqual(
    {},
  );
  const carried = authorizationTargetsUnlessHeld(writeHeader("older"), "held");
  expect(carried).toEqual({ authorizationTargets });
  // A copy, so the response never aliases the stored set.
  expect(carried.authorizationTargets).not.toBe(authorizationTargets);
});

import { expect, test } from "bun:test";
import {
  computeDocumentBaselineSegmentsDigest,
  type DocumentBaselineSegmentDigestEntry,
  extendDocumentBaselineSegmentsDigest,
  startDocumentBaselineSegmentsDigest,
} from "../index";

const group = { baselineId: "baseline-1", documentId: "document-1" };

function segment(name: string): DocumentBaselineSegmentDigestEntry {
  return {
    ciphertextHash: `ciphertext-${name}`,
    metadataHash: `metadata-${name}`,
    updateId: `update-${name}`,
  };
}

test("a baseline with no earlier segment signs its start digest", async () => {
  const start = await startDocumentBaselineSegmentsDigest(group);
  expect(start).toMatch(/^[0-9a-f]{64}$/u);
  expect(
    await computeDocumentBaselineSegmentsDigest({ ...group, segments: [] }),
  ).toBe(start);
  for (const other of [
    { ...group, baselineId: "baseline-2" },
    { ...group, documentId: "document-2" },
  ]) {
    expect(await startDocumentBaselineSegmentsDigest(other)).not.toBe(start);
  }
});

test("the digest is the chain a reader extends one segment at a time", async () => {
  const segments = [segment("a"), segment("b"), segment("c")];
  let chained = await startDocumentBaselineSegmentsDigest(group);
  for (const [segmentIndex, entry] of segments.entries()) {
    chained = await extendDocumentBaselineSegmentsDigest(chained, {
      ...entry,
      segmentIndex,
    });
  }
  expect(
    await computeDocumentBaselineSegmentsDigest({ ...group, segments }),
  ).toBe(chained);
});

test("the digest changes with any segment's place, id or hashes", async () => {
  const [a, b, c] = [segment("a"), segment("b"), segment("c")];
  const lists: DocumentBaselineSegmentDigestEntry[][] = [
    [a, b, c],
    [a, c, b],
    [a, b],
    [a, c],
    [a, b, c, c],
    [a, { ...b, updateId: "update-x" }, c],
    [a, { ...b, metadataHash: "metadata-x" }, c],
    [a, { ...b, ciphertextHash: "ciphertext-x" }, c],
    [],
  ];
  const digests = await Promise.all(
    lists.map((segments) =>
      computeDocumentBaselineSegmentsDigest({ ...group, segments }),
    ),
  );
  expect(new Set(digests).size).toBe(lists.length);
});

// A reader extends the chain with the index a served segment signs, so the
// step commits to it apart from the segment's position in any list.
test("a step commits to the segment's index", async () => {
  const start = await startDocumentBaselineSegmentsDigest(group);
  const steps = await Promise.all(
    [0, 1, 63].map((segmentIndex) =>
      extendDocumentBaselineSegmentsDigest(start, {
        ...segment("a"),
        segmentIndex,
      }),
    ),
  );
  expect(new Set(steps).size).toBe(steps.length);
});

// A start digest and a step digest hash different payloads under one domain;
// a step that names the start's fields as hashes must not collide with it.
test("a step never equals a start", async () => {
  const start = await startDocumentBaselineSegmentsDigest(group);
  const step = await extendDocumentBaselineSegmentsDigest(start, {
    ciphertextHash: group.documentId,
    metadataHash: group.baselineId,
    segmentIndex: 0,
    updateId: group.baselineId,
  });
  expect(step).not.toBe(start);
});

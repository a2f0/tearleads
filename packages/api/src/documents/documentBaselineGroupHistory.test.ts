import { expect, test } from "bun:test";
import { computeDocumentBaselineSegmentsDigest } from "@tearleads/crypto";
import {
  createDocument,
  encodeVersionVector,
  exportHistorySegments,
  importUpdates,
  versionVectorsEqual,
} from "@tearleads/loro";
import {
  type DocumentBaselineSegment,
  judgeDocumentBaselineGroup,
} from "./documentBaselineGroup";

const DOCUMENT_ID = "6f1b1f8e-4f5a-4c4e-9a52-6f0a1b2c3d4e";
const BASELINE_ID = "0e7c4d7a-1b2c-4d3e-8f90-a1b2c3d4e5f6";

/** Three writers that each build on what the others wrote. */
async function interleavedHistory() {
  const writers = await Promise.all(
    ["first", "second", "third"].map((name) =>
      createDocument(`baseline-history-${name}`),
    ),
  );
  for (let round = 0; round < 10; round += 1) {
    for (const [index, writer] of writers.entries()) {
      writer.getText("text").insert(0, `writer ${index} round ${round}\n`);
      writer.commit();
      for (const other of writers) {
        if (other !== writer) {
          importUpdates(other, [writer.export({ mode: "update" })]);
        }
      }
    }
  }
  const [document] = writers;
  if (!document) throw new Error("Expected a document");
  return document;
}

// The group rules read a segment's declared vectors, which an honest writer
// takes from the bytes Loro exports. The walk must accept every group the
// segmenter cuts, whatever peers a segment's vectors name, and reach exactly
// the history that was cut.
test("the segments a writer cuts from a history of several peers pass the group rules", async () => {
  const document = await interleavedHistory();
  for (const sizes of [
    { maxBytes: 1024, targetBytes: 96 },
    { maxBytes: 1024, targetBytes: 256 },
    { maxBytes: 4096, targetBytes: 2048 },
  ]) {
    const ranges = [...exportHistorySegments(document, sizes)];
    const segments: DocumentBaselineSegment[] = ranges.map((range, index) => ({
      baselineId: BASELINE_ID,
      baselineSegmentCount: undefined,
      baselineSegmentIndex: index,
      baselineSegmentsDigest: undefined,
      ciphertextHash: `ciphertext-${index}`,
      coversThroughUpdateId: undefined,
      dependencyVersionVector: range.dependencyVersionVector,
      metadataHash: `metadata-${index}`,
      partialEndVersionVector: range.partialEndVersionVector,
      partialStartVersionVector: range.partialStartVersionVector,
      updateId: `update-${index}`,
    }));
    const final = segments.at(-1);
    if (!final) throw new Error("Expected segments");
    const verdict = await judgeDocumentBaselineGroup({
      documentId: DOCUMENT_ID,
      segments: [
        ...segments.slice(0, -1),
        {
          ...final,
          baselineSegmentCount: segments.length,
          baselineSegmentsDigest: await computeDocumentBaselineSegmentsDigest({
            baselineId: BASELINE_ID,
            documentId: DOCUMENT_ID,
            segments: segments.slice(0, -1),
          }),
        },
      ],
    });
    if (!verdict.ok) throw new Error(`Refused: ${verdict.fault}`);
    expect(
      versionVectorsEqual(
        verdict.group.coverage,
        encodeVersionVector(document),
      ),
    ).toBe(true);
  }
});

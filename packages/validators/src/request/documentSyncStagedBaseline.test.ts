import { expect, test } from "bun:test";
import {
  MAX_DOCUMENT_BASELINE_SEGMENTS,
  MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS,
} from "../util";
import {
  isDocumentLinkSetMutationRequest,
  isDocumentSyncRequest,
} from "./index";

const BASELINE_ID = "550e8400-e29b-41d4-a716-446655440222";

function update(fields: object = {}) {
  return {
    dependencyVersionVector: "{}",
    encryptedData: "ciphertext",
    id: crypto.randomUUID(),
    partialEndVersionVector: '{"actor":1}',
    partialStartVersionVector: "{}",
    plaintextHash: "plaintext-hash",
    writeHeader: { signed: true },
    ...fields,
  };
}

function syncRequest(fields: object) {
  return {
    authorizingContainerPathRefs: [
      [{ containerId: "container-1", manifestHash: "container-manifest-hash" }],
    ],
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "document-link-set-hash",
    expectedTargetHash: "target-hash",
    localVersionVector: null,
    outgoingUpdates: [],
    supportsPullPagination: true,
    ...fields,
  };
}

// A staged baseline's final segment travels inline with an index and count
// past what one request's group holds. How many segments a request carries
// stays bounded where its array is declared.
test("a final segment's index and count reach the staged cap, and a request's group does not", () => {
  const lastIndex = MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS - 1;
  const final = (index: number) =>
    update({
      baselineId: BASELINE_ID,
      baselineSegmentCount: index + 1,
      baselineSegmentIndex: index,
      baselineSegmentsDigest: "ab".repeat(32),
    });
  const commits = (index: number) =>
    isDocumentSyncRequest(
      syncRequest({
        baselineStageId: BASELINE_ID,
        outgoingUpdates: [final(index)],
      }),
    );
  expect(MAX_DOCUMENT_BASELINE_SEGMENTS).toBeLessThan(lastIndex);
  expect(commits(MAX_DOCUMENT_BASELINE_SEGMENTS)).toBe(true);
  expect(commits(lastIndex)).toBe(true);
  expect(commits(lastIndex + 1)).toBe(false);

  // More segments than one request's group holds are not a request.
  const segments = Array.from(
    { length: MAX_DOCUMENT_BASELINE_SEGMENTS + 1 },
    (_, index) =>
      update({ baselineId: BASELINE_ID, baselineSegmentIndex: index }),
  );
  expect(
    isDocumentSyncRequest(syncRequest({ outgoingUpdates: segments })),
  ).toBe(false);
  expect(
    isDocumentSyncRequest(
      syncRequest({
        outgoingUpdates: segments.slice(0, MAX_DOCUMENT_BASELINE_SEGMENTS),
      }),
    ),
  ).toBe(true);
});

test("a stage is named by a UUID on both rotating requests", () => {
  for (const baselineStageId of ["stage", "", 7, null]) {
    expect([
      baselineStageId,
      isDocumentSyncRequest(syncRequest({ baselineStageId })),
    ]).toEqual([baselineStageId, false]);
  }
  expect(
    isDocumentSyncRequest(syncRequest({ baselineStageId: BASELINE_ID })),
  ).toBe(true);

  const unlink = (fields: object) =>
    isDocumentLinkSetMutationRequest({
      authorizingContainerPathRefs: [
        [{ containerId: "container-1", manifestHash: "manifest-hash" }],
      ],
      body: {},
      contentKeyBundle: {
        contentKeyCommitment: "c".repeat(64),
        contentKeyEpoch: 2,
        linkSetManifestHash: "document-link-set-hash",
        targetHash: "target-hash",
        targets: [],
      },
      event: {},
      expectedManifestHash: "manifest-hash",
      targetContainerPathRefs: [
        { containerId: "container-1", manifestHash: "manifest-hash" },
      ],
      ...fields,
    });
  expect(unlink({})).toBe(true);
  expect(unlink({ baselineStageId: BASELINE_ID })).toBe(true);
  expect(unlink({ baselineStageId: "stage" })).toBe(false);
});

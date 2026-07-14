import { expect, test } from "bun:test";
import {
  compactDocumentEditAttributionSegments,
  createDocumentEditAttributionRangesPage,
  createDocumentEditAttributionResponse,
  type DocumentEditAttributionError,
  MAX_COMPACT_ATTRIBUTION_SEGMENTS,
} from "./documentEditAttribution";

function detailedSegment(input: {
  endCounter: number;
  startCounter: number;
  updateSequence: number;
  authorityKind?: "baseline" | "direct";
  peerId?: string;
}) {
  return {
    authorityKind: input.authorityKind ?? ("direct" as const),
    endCounter: input.endCounter,
    peerId: input.peerId ?? "peer-1",
    startCounter: input.startCounter,
    updateId: `update-${input.updateSequence}`,
    updateSequence: input.updateSequence,
    writerKeyFingerprint: "fingerprint-1",
    writerUserId: "user-1",
  };
}

function expectAttributionStatus(
  action: () => unknown,
  status: DocumentEditAttributionError["status"],
): void {
  try {
    action();
  } catch (error) {
    expect((error as DocumentEditAttributionError).status).toBe(status);
    return;
  }
  throw new Error(`Expected attribution error with status ${status}`);
}

test("compacts adjacent effective ranges with the same authority identity", () => {
  const segments = [
    detailedSegment({ endCounter: 2, startCounter: 0, updateSequence: 1 }),
    detailedSegment({ endCounter: 5, startCounter: 2, updateSequence: 2 }),
    detailedSegment({
      authorityKind: "baseline",
      endCounter: 7,
      startCounter: 5,
      updateSequence: 3,
    }),
    detailedSegment({
      endCounter: 3,
      peerId: "peer-2",
      startCounter: 0,
      updateSequence: 4,
    }),
  ];

  expect(compactDocumentEditAttributionSegments(segments)).toEqual([
    {
      authorityKind: "direct",
      endCounter: 5,
      peerId: "peer-1",
      startCounter: 0,
      writerKeyFingerprint: "fingerprint-1",
      writerUserId: "user-1",
    },
    {
      authorityKind: "baseline",
      endCounter: 7,
      peerId: "peer-1",
      startCounter: 5,
      writerKeyFingerprint: "fingerprint-1",
      writerUserId: "user-1",
    },
    {
      authorityKind: "direct",
      endCounter: 3,
      peerId: "peer-2",
      startCounter: 0,
      writerKeyFingerprint: "fingerprint-1",
      writerUserId: "user-1",
    },
  ]);
});

test("caps the default compact response and marks it truncated", () => {
  const response = createDocumentEditAttributionResponse({
    attributionScope: "scope-large",
    attributionRevision: 3,
    documentId: "document-large",
    documentIncarnation: "incarnation-large",
    segments: Array.from(
      { length: MAX_COMPACT_ATTRIBUTION_SEGMENTS + 1 },
      (_, index) =>
        detailedSegment({
          endCounter: index + 1,
          peerId: `peer-${index}`,
          startCounter: index,
          updateSequence: index + 1,
        }),
    ),
  });

  expect(response.segments).toHaveLength(MAX_COMPACT_ATTRIBUTION_SEGMENTS);
  expect(response.truncated).toBe(true);
});

test("paginates ranges with an incarnation and revision-bound cursor", () => {
  const attribution = {
    attributionScope: "scope-1",
    attributionRevision: 12,
    documentId: "document-1",
    segments: [
      detailedSegment({ endCounter: 1, startCounter: 0, updateSequence: 1 }),
      detailedSegment({ endCounter: 2, startCounter: 1, updateSequence: 2 }),
      detailedSegment({ endCounter: 3, startCounter: 2, updateSequence: 3 }),
    ],
  };
  const first = createDocumentEditAttributionRangesPage(attribution, {
    limit: 2,
  });
  expect(first.items.map((item) => item.updateId)).toEqual([
    "update-1",
    "update-2",
  ]);
  if (!first.nextCursor) {
    throw new Error("Expected a next attribution cursor");
  }
  const nextCursor = first.nextCursor;
  expect(
    createDocumentEditAttributionRangesPage(attribution, {
      cursor: nextCursor,
      limit: 2,
    }).items.map((item) => item.updateId),
  ).toEqual(["update-3"]);

  expectAttributionStatus(
    () =>
      createDocumentEditAttributionRangesPage(
        { ...attribution, attributionRevision: 13 },
        { cursor: nextCursor },
      ),
    409,
  );
  expectAttributionStatus(
    () =>
      createDocumentEditAttributionRangesPage(
        { ...attribution, attributionScope: "scope-recreated" },
        { cursor: nextCursor },
      ),
    400,
  );
  expectAttributionStatus(
    () => createDocumentEditAttributionRangesPage(attribution, { cursor: "" }),
    400,
  );
  expectAttributionStatus(
    () =>
      createDocumentEditAttributionRangesPage(attribution, {
        expectedRevision: 11,
      }),
    409,
  );
});

test("range pages default to 100 items and reject limits over 500", () => {
  const attribution = {
    attributionScope: "scope-default-limit",
    attributionRevision: 1,
    documentId: "document-default-limit",
    segments: Array.from({ length: 101 }, (_, index) =>
      detailedSegment({
        endCounter: index + 1,
        startCounter: index,
        updateSequence: index + 1,
      }),
    ),
  };

  expect(
    createDocumentEditAttributionRangesPage(attribution, {}).items,
  ).toHaveLength(100);
  expectAttributionStatus(
    () => createDocumentEditAttributionRangesPage(attribution, { limit: 501 }),
    400,
  );
});

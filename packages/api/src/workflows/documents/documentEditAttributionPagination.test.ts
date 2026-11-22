import { expect, test } from "bun:test";
import { encodeCursor } from "../../utils/cursor";
import {
  compactDocumentEditAttributionSegments,
  createDocumentEditAttributionRangesPage,
  createDocumentEditAttributionResponse,
  type DocumentEditAttributionError,
  MAX_COMPACT_ATTRIBUTION_SEGMENTS,
} from "./documentEditAttribution";

/** One second per upload, so each upload's times are its own. */
function uploadTime(second: number): string {
  return new Date(Date.UTC(2030, 0, 1, 0, 0, second)).toISOString();
}

function detailedSegment(input: {
  endCounter: number;
  startCounter: number;
  updateSequence: number;
  authorityKind?: "baseline" | "direct";
  peerId?: string;
}) {
  return {
    authorityKind: input.authorityKind ?? ("direct" as const),
    createdAt: uploadTime(input.updateSequence),
    endCounter: input.endCounter,
    peerId: input.peerId ?? "peer-1",
    signedAt: uploadTime(input.updateSequence - 1),
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

test("a range whose stored signed time is not a timestamp is refused, by update", () => {
  // A write header is only accepted with a canonical signedAt, so such a row
  // is a broken one.
  for (const signedAt of ["", "yesterday", "2030-01-01 10:00:00"]) {
    const attribution = {
      attributionRevision: 12,
      attributionScope: "scope-1",
      documentId: "document-1",
      documentIncarnation: "incarnation-1",
      segments: [
        {
          ...detailedSegment({
            endCounter: 1,
            startCounter: 0,
            updateSequence: 1,
          }),
          signedAt,
        },
      ],
    };

    expect(() =>
      createDocumentEditAttributionRangesPage(attribution, {}),
    ).toThrow(
      "Attribution update update-1 has no valid signedAt in its write header.",
    );
    // The compact response never returns the time, so it is unaffected.
    expect(
      createDocumentEditAttributionResponse(attribution).segments,
    ).toHaveLength(1);
  }
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
  // Each range carries its own upload's two times, and nothing server-only.
  expect(first.items[1]).toEqual({
    authorityKind: "direct",
    createdAt: uploadTime(2),
    endCounter: 2,
    peerId: "peer-1",
    signedAt: uploadTime(1),
    startCounter: 1,
    updateId: "update-2",
    writerKeyFingerprint: "fingerprint-1",
    writerUserId: "user-1",
  });
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

test("range cursors reject every malformed decoded payload with 400", () => {
  const attribution = {
    attributionScope: "scope-1",
    attributionRevision: 12,
    documentId: "document-1",
    segments: [
      detailedSegment({ endCounter: 1, startCounter: 0, updateSequence: 1 }),
      detailedSegment({ endCounter: 2, startCounter: 1, updateSequence: 2 }),
    ],
  };
  const valid = {
    attributionRevision: 12,
    attributionScope: "scope-1",
    documentId: "document-1",
    offset: 1,
    version: 1,
  };
  const { version: _version, ...withoutVersion } = valid;
  const { documentId: _documentId, ...withoutDocumentId } = valid;
  const { attributionScope: _scope, ...withoutScope } = valid;
  const { attributionRevision: _revision, ...withoutRevision } = valid;
  const { offset: _offset, ...withoutOffset } = valid;
  const malformed: readonly unknown[] = [
    null,
    "cursor",
    1,
    true,
    [],
    [valid],
    withoutVersion,
    withoutDocumentId,
    withoutScope,
    withoutRevision,
    withoutOffset,
    { ...valid, version: 2 },
    { ...valid, version: "1" },
    { ...valid, documentId: 1 },
    { ...valid, documentId: null },
    { ...valid, attributionScope: 1 },
    ...[-1, 1.5, 2 ** 53, "12", null].map((attributionRevision) => ({
      ...valid,
      attributionRevision,
    })),
    ...[-1, 0.5, 2 ** 53, "1", null].map((offset) => ({ ...valid, offset })),
    { ...valid, offset: 3 },
  ];
  for (const payload of malformed) {
    expectAttributionStatus(
      () =>
        createDocumentEditAttributionRangesPage(attribution, {
          cursor: encodeCursor(payload),
        }),
      400,
    );
  }
  expect(
    createDocumentEditAttributionRangesPage(attribution, {
      cursor: encodeCursor({ ...valid, extra: true }),
    }).items.map((item) => item.updateId),
  ).toEqual(["update-2"]);
  expect(
    createDocumentEditAttributionRangesPage(
      { ...attribution, attributionRevision: 0 },
      { cursor: encodeCursor({ ...valid, attributionRevision: 0, offset: 0 }) },
    ).items,
  ).toHaveLength(2);
});

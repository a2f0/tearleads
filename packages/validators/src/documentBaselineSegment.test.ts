import { expect, test } from "bun:test";
import {
  classifyDocumentBaselineSegmentFields,
  type DocumentBaselineSegmentFieldClassification,
} from "./documentBaselineSegment";
import {
  MAX_DOCUMENT_BASELINE_SEGMENTS,
  MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
} from "./util/documentSyncLimits";

const fields = {
  baselineId: "550e8400-e29b-41d4-a716-446655440000",
  baselineSegmentCount: 2,
  baselineSegmentIndex: 1,
  baselineSegmentsDigest: "ab".repeat(32),
  coversThroughUpdateId: "550e8400-e29b-41d4-a716-446655440001",
};
type Field = keyof typeof fields;
const order: readonly Field[] = [
  "baselineId",
  "baselineSegmentIndex",
  "baselineSegmentCount",
  "baselineSegmentsDigest",
  "coversThroughUpdateId",
];

/** The classification of each presence state the decoder can produce. */
function expected(
  present: ReadonlySet<Field>,
): DocumentBaselineSegmentFieldClassification {
  if (present.size === 0) return "absent";
  if (!present.has("baselineId") || !present.has("baselineSegmentIndex")) {
    return "invalid";
  }
  const count = present.has("baselineSegmentCount");
  const digest = present.has("baselineSegmentsDigest");
  if (count !== digest) return "invalid";
  if (count) return "final-segment";
  return present.has("coversThroughUpdateId") ? "invalid" : "segment";
}

test("classifies every baseline field-presence state", () => {
  const seen = new Map<DocumentBaselineSegmentFieldClassification, number>();
  for (let mask = 0; mask < 1 << order.length; mask += 1) {
    const present = new Set(order.filter((_, bit) => (mask & (1 << bit)) > 0));
    const classification = classifyDocumentBaselineSegmentFields(
      Object.fromEntries(
        order.map((field) => [
          field,
          present.has(field) ? fields[field] : undefined,
        ]),
      ),
    );
    expect(classification).toBe(expected(present));
    seen.set(classification, (seen.get(classification) ?? 0) + 1);
  }
  expect(Object.fromEntries(seen)).toEqual({
    absent: 1,
    "final-segment": 2,
    invalid: 28,
    segment: 1,
  });
});

test("classifies presence by definedness, not by value", () => {
  // Field-level validation rejects these values before the classifier runs.
  expect(
    classifyDocumentBaselineSegmentFields({
      baselineId: "",
      baselineSegmentIndex: 0,
    }),
  ).toBe("segment");
  expect(
    classifyDocumentBaselineSegmentFields({
      baselineId: "",
      baselineSegmentCount: 0,
      baselineSegmentIndex: 0,
      baselineSegmentsDigest: "",
    }),
  ).toBe("final-segment");
});

test("a processed cursor belongs only to a baseline's final segment", () => {
  const { coversThroughUpdateId } = fields;
  expect(classifyDocumentBaselineSegmentFields({ coversThroughUpdateId })).toBe(
    "invalid",
  );
  expect(
    classifyDocumentBaselineSegmentFields({
      baselineId: fields.baselineId,
      baselineSegmentIndex: 0,
      coversThroughUpdateId,
    }),
  ).toBe("invalid");
  expect(classifyDocumentBaselineSegmentFields(fields)).toBe("final-segment");
});

// A baseline travels whole among one sync's outgoing updates.
test("a baseline's segments fit one sync request's update count", () => {
  expect(MAX_DOCUMENT_BASELINE_SEGMENTS).toBeLessThanOrEqual(
    MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
  );
});

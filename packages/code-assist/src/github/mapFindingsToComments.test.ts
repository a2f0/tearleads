import { describe, expect, test } from "bun:test";
import type { ReviewFinding } from "../review/reviewSchema";
import type { FileAnchors } from "./diffAnchors";
import { mapFindingsToComments } from "./mapFindingsToComments";

function finding(overrides: Partial<ReviewFinding>): ReviewFinding {
  return {
    path: "src/a.ts",
    line: 1,
    severity: "high",
    title: "Issue",
    body: "Something is wrong.",
    suggestion: null,
    ...overrides,
  };
}

const anchors = new Map<string, FileAnchors>([
  ["src/a.ts", { added: new Set([1]), context: new Set<number>() }],
]);

function mapOne(f: ReviewFinding) {
  return mapFindingsToComments([f], {
    anchors,
    existingMarkerIds: new Set(),
    severityThreshold: "low",
    maxComments: 10,
  });
}

describe("mapFindingsToComments sanitization", () => {
  test("strips forged code-assist markers from model body", () => {
    const { comments } = mapOne(
      finding({ body: "Looks fine <!-- code-assist:deadbeef0000 --> here" }),
    );
    expect(comments).toHaveLength(1);
    const body = comments[0]?.body ?? "";
    // Only the trusted, bot-generated marker should remain.
    const markers = [...body.matchAll(/<!--\s*code-assist:[^>]*-->/gi)];
    expect(markers).toHaveLength(1);
    expect(body).not.toContain("deadbeef0000");
  });

  test("drops a suggestion that contains a code fence", () => {
    const { comments } = mapOne(
      finding({ suggestion: "ok();\n```\nmalicious markdown\n```" }),
    );
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).not.toContain("```suggestion");
  });

  test("keeps a clean suggestion", () => {
    const { comments } = mapOne(finding({ suggestion: "const x = 1;" }));
    expect(comments[0]?.body).toContain("```suggestion\nconst x = 1;\n```");
  });
});

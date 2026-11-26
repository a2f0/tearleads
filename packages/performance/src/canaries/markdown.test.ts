import { expect, test } from "bun:test";
import { formatCanaryReport, formatComparison, formatRange } from "./markdown";
import type { PhaseMetrics } from "./output";
import type { CanaryReport } from "./report";
import { comparePhases, summarizePhases } from "./summary";

const phase = (label: string, count: number): PhaseMetrics => ({
  label,
  total: count,
  bodyBytes: { request: 1_500 * count, response: 20 },
  syncIntents: { readOnly: 0, writeBearing: 0 },
  byRequest: {
    "GET /a|b": { count, bodyBytes: { request: 1_500 * count, response: 20 } },
  },
  repeatedPaths: [],
});

function report(counts: number[], statements = false): CanaryReport {
  const runs = counts.map((count, index) => ({
    canary: "Upload",
    file: "src/Upload.test.tsx",
    sample: index + 1,
    status: "passed" as const,
    exitCode: 0,
    wallMs: 12_345,
    tests: { pass: 1, fail: 0 },
    log: "/private/upload.log",
    phases: [phase("upload", count), phase("upload", 1)],
    statements: statements ? { capture: "c", perPhase: [10 * count, 4] } : null,
  }));
  return {
    schemaVersion: 1,
    scenario: "request-volume-canaries",
    runId: "run",
    startedAt: "2026-11-26T00:00:00.000Z",
    updatedAt: "2026-11-26T00:01:00.000Z",
    status: "complete",
    revision: "0123456789abcdef",
    dirty: false,
    runtime: { bun: "1.4.2", platform: "darwin", arch: "arm64", cpu: "M2" },
    options: {
      canaries: [],
      samples: counts.length,
      statements,
      paramHash: false,
    },
    boundary: "Boundary",
    summary: summarizePhases(runs),
    runs,
  };
}

test("formats ranges with grouping and collapses equal ends", () => {
  expect(formatRange({ min: 1_234, max: 1_234 })).toBe("1,234");
  expect(formatRange({ min: 1, max: 2_000 })).toBe("1–2,000");
});

test("renders the run table, phase tables and endpoint tables", () => {
  const markdown = formatCanaryReport(report([2, 3]));
  expect(markdown).toContain("2 samples per canary");
  expect(markdown).toContain(
    "| Upload | 2 | passed | 1 pass, 0 fail | 12.3 s |",
  );
  expect(markdown).toContain("## Upload");
  expect(markdown).toContain("| upload | 2–3 | 3,000–4,500 | 20 |");
  expect(markdown).toContain("### upload (2)");
  expect(markdown).toContain("| `GET /a\\|b` | 2–3 | 3,000–4,500 | 20 |");
  expect(markdown.endsWith("\n")).toBe(true);
});

test("lists only changed phases and their changed endpoints", () => {
  const before = report([3]);
  const after = report([2]);
  const markdown = formatComparison(
    comparePhases(before.summary, after.summary),
    { before: "run b", after: "run a" },
  );
  expect(markdown).toContain("1 of 2 phases changed");
  expect(markdown).toContain(
    "| Upload | upload | 3 → 2 (-1) | 4,500 → 3,000 (-1,500) | 20 |",
  );
  expect(markdown).not.toContain("upload (2) |");
  expect(markdown).toContain("| `GET /a\\|b` | 3 → 2 (-1) |");
  const unchanged = formatComparison(
    comparePhases(before.summary, before.summary),
    { before: "x", after: "y" },
  );
  expect(unchanged).toContain("0 of 2 phases changed");
  expect(unchanged).not.toContain("| Canary |");
});

test("summarizes a removed phase in one row", () => {
  const markdown = formatComparison(comparePhases(report([3]).summary, []), {
    before: "b",
    after: "a",
  });
  expect(markdown).toContain("| Upload | upload | 3 → removed |");
  expect(markdown).not.toContain("## Upload");
});

test("adds a statements column when the runs captured statements", () => {
  const markdown = formatCanaryReport(report([2, 3], true));
  expect(markdown).toContain(
    "| Phase | Requests | Request bytes | Response bytes | Statements |",
  );
  expect(markdown).toContain("| upload | 2–3 | 3,000–4,500 | 20 | 20–30 |");
  expect(formatCanaryReport(report([2]))).not.toContain("Statements");
  const comparison = formatComparison(
    comparePhases(report([3], true).summary, report([2], true).summary),
    { before: "b", after: "a" },
  );
  expect(comparison).toContain("| 30 → 20 (-10) |");
});

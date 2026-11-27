import { expect, test } from "bun:test";
import { parsePlanOptions } from "./options";
import {
  analyzeExplainJson,
  formatPlanSummaryMarkdown,
  prepareSqlForGenericPlan,
  summarizePlans,
} from "./planAnalysis";

test("re-expands collapsed placeholder lists for PostgreSQL GENERIC_PLAN", () => {
  expect(
    prepareSqlForGenericPlan(
      'select * from "docs" where org_id = $1 and id in ($n, …)',
    ),
  ).toBe('select * from "docs" where org_id = $1 and id in ($2)');
});

test("walks EXPLAIN JSON plans and flags Seq Scan and Sort nodes", () => {
  const analyzed = analyzeExplainJson([
    {
      Plan: {
        "Node Type": "Sort",
        Plans: [
          {
            "Node Type": "Seq Scan",
            "Relation Name": "documents",
          },
          {
            "Node Type": "Index Scan",
            "Relation Name": "containers",
          },
        ],
      },
    },
  ]);
  expect(analyzed.nodeTypes).toEqual(["Sort", "Seq Scan", "Index Scan"]);
  expect(analyzed.warnings).toEqual([
    { kind: "Sort" },
    { kind: "Seq Scan", relation: "documents" },
  ]);

  const summary = summarizePlans([
    {
      sql: 'select * from "documents" order by updated_at',
      count: 42,
      status: "planned",
      ...analyzed,
    },
    {
      sql: 'select * from "bad"',
      count: 2,
      status: "skipped",
      nodeTypes: [],
      warnings: [],
      error: "syntax error",
    },
  ]);
  expect(summary).toMatchObject({
    inspected: 2,
    planned: 1,
    skipped: 1,
    seqScanQueries: 1,
    sortQueries: 1,
  });
  const md = formatPlanSummaryMarkdown(summary, "Intro.");
  expect(md).toContain("Seq Scan (documents)");
  expect(md).toContain("skipped (syntax error)");
});

test("parses plan CLI options and refuses invalid flags", () => {
  expect(parsePlanOptions(["--help"])).toBeNull();
  expect(parsePlanOptions(["--capture", "a.jsonl"])).toEqual({
    capture: "a.jsonl",
    limit: 20,
    disableSeqScan: false,
  });
  expect(
    parsePlanOptions([
      "--capture",
      "a.jsonl",
      "--limit",
      "5",
      "--disable-seqscan",
    ]),
  ).toEqual({
    capture: "a.jsonl",
    limit: 5,
    disableSeqScan: true,
  });
  expect(() => parsePlanOptions([])).toThrow(/--capture/);
  expect(() => parsePlanOptions(["--capture", "a.jsonl", "extra"])).toThrow(
    /Unexpected/,
  );
});

import { test } from "bun:test";
import assert from "node:assert/strict";
import { normalizeVerdict } from "./verdict";

const criteria = [
  { id: "build", prompt: "Build succeeds.", dependsOn: [], gates: [] },
  { id: "tests", prompt: "Tests pass.", dependsOn: ["build"], gates: [] },
] satisfies import("../types").Criterion[];
const result = (criterionId: string, passed = true) => ({
  criterionId,
  passed,
  feedback: `Observed ${criterionId}`,
});

test("an actual failure blocks its descendant and preserves feedback", () => {
  const verdict = normalizeVerdict(
    { results: [result("tests"), result("build", false)] },
    criteria,
  );
  assert.equal(verdict.passed, false);
  assert.deepEqual(
    verdict.criteriaResults.map((r) => [r.criterionId, r.passed, r.evaluated]),
    [
      ["build", false, true],
      ["tests", false, false],
    ],
  );
  assert.match(verdict.feedback, /Observed build/);
  assert.doesNotMatch(verdict.feedback, /Observed tests/);
});

test("all complete verdicts are needed for a pass", () => {
  const verdict = normalizeVerdict(
    { results: [result("tests"), result("build")] },
    criteria,
  );
  assert.equal(verdict.passed, true);
  assert.equal(verdict.criteriaResults.length, 2);
});

for (const [name, raw] of [
  ["empty output", { results: [] }],
  ["missing criterion", { results: [result("build")] }],
  ["duplicate criterion", { results: [result("build"), result("build")] }],
  ["unknown criterion", { results: [result("build"), result("unrelated")] }],
  [
    "string boolean",
    { results: [{ ...result("build"), passed: "true" }, result("tests")] },
  ],
  [
    "missing explanation",
    { results: [{ ...result("build"), feedback: "" }, result("tests")] },
  ],
] as const) {
  test(`${name} is an infrastructure error, never a pass`, () => {
    assert.throws(() => normalizeVerdict(raw, criteria));
  });
}

test("a cyclic dependency graph is rejected", () => {
  assert.throws(
    () =>
      normalizeVerdict({ results: [result("build"), result("tests")] }, [
        { id: "build", prompt: "Build", dependsOn: ["tests"], gates: [] },
        { id: "tests", prompt: "Test", dependsOn: ["build"], gates: [] },
      ]),
    /Cycle/,
  );
});

test("zero criteria cannot create a vacuous pass", () => {
  assert.throws(
    () => normalizeVerdict({ results: [result("build")] }, []),
    /empty/,
  );
});

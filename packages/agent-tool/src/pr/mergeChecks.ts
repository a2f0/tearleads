import { run } from "../git/prContext";

const requiredChecks = [
  "CI gate",
  "Lint",
  "Build and test",
  "Postgres concurrency",
  "windows / Windows CEF persistence",
];

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

export function assertMergeChecks(source: string, expectedHead: string): void {
  const payload: unknown = JSON.parse(source);
  if (field(payload, "headRefOid") !== expectedHead) {
    throw new Error(
      "PR head changed while checking CI; re-review before merging.",
    );
  }
  const checks = field(payload, "checks");
  if (!Array.isArray(checks) || checks.length === 0) {
    throw new Error("PR has no CI checks; refusing to merge.");
  }
  const passed = new Set<string>();
  for (const check of checks) {
    const name = field(check, "name");
    const success = field(check, "state") === "SUCCESS";
    const skipped = field(check, "state") === "SKIPPED";
    if (!success && !skipped) {
      throw new Error(
        `CI check '${String(name)}' has not passed; refusing to merge.`,
      );
    }
    if (
      success &&
      typeof name === "string" &&
      field(check, "workflow") === "CI"
    ) {
      passed.add(name);
    }
  }
  for (const name of requiredChecks) {
    if (!passed.has(name)) {
      throw new Error(
        `Required CI check '${name}' has not passed; refusing to merge.`,
      );
    }
  }
}

export function requirePassingMergeChecks(
  pr: { readonly prNumber: string; readonly repo: string },
  expectedHead: string,
  read: typeof run = run,
): void {
  // gh pr checks paginates and selects the latest run per workflow/job/event.
  // Raw statusCheckRollup can retain failures from superseded runs. Nonzero
  // exits (including pending checks and API failures) throw before any merge.
  const checks: unknown = JSON.parse(
    read("gh", [
      "pr",
      "checks",
      pr.prNumber,
      "-R",
      pr.repo,
      "--json",
      "name,state,workflow",
    ]),
  );
  const head: unknown = JSON.parse(
    read("gh", [
      "pr",
      "view",
      pr.prNumber,
      "-R",
      pr.repo,
      "--json",
      "headRefOid",
    ]),
  );
  assertMergeChecks(
    JSON.stringify({ headRefOid: field(head, "headRefOid"), checks }),
    expectedHead,
  );
}

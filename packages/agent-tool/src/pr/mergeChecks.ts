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
  const checks = field(payload, "statusCheckRollup");
  if (!Array.isArray(checks) || checks.length === 0) {
    throw new Error("PR has no CI checks; refusing to merge.");
  }
  const passed = new Set<string>();
  for (const check of checks) {
    const name = field(check, "name") ?? field(check, "context");
    const status = field(check, "status");
    const conclusion = field(check, "conclusion");
    const checkRun = field(check, "__typename") === "CheckRun";
    const success = checkRun
      ? status === "COMPLETED" && conclusion === "SUCCESS"
      : field(check, "__typename") === "StatusContext" &&
        field(check, "state") === "SUCCESS";
    const skipped =
      checkRun && status === "COMPLETED" && conclusion === "SKIPPED";
    if (!success && !skipped) {
      throw new Error(
        `CI check '${String(name)}' has not passed; refusing to merge.`,
      );
    }
    if (success && typeof name === "string") passed.add(name);
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
): void {
  assertMergeChecks(
    run("gh", [
      "pr",
      "view",
      pr.prNumber,
      "-R",
      pr.repo,
      "--json",
      "headRefOid,statusCheckRollup",
    ]),
    expectedHead,
  );
}

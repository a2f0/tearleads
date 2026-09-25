import { expect, test } from "bun:test";
import { assertMergeChecks } from "./mergeChecks";

const check = (name: string, conclusion = "SUCCESS", status = "COMPLETED") => ({
  __typename: "CheckRun",
  name,
  conclusion,
  status,
});
const coreChecks = () =>
  [
    "CI gate",
    "Lint",
    "Build and test",
    "Postgres concurrency",
    "windows / Windows CEF persistence",
  ].map((name) => check(name));
const response = (checks: unknown[], headRefOid = "reviewed") =>
  JSON.stringify({ headRefOid, statusCheckRollup: checks });

test("accepts completed CI and deliberately skipped optional jobs", () => {
  expect(() =>
    assertMergeChecks(
      response([
        ...coreChecks(),
        check("Windows CEF persistence"),
        check("installer", "SKIPPED"),
        { __typename: "StatusContext", context: "external", state: "SUCCESS" },
      ]),
      "reviewed",
    ),
  ).not.toThrow();
});

test("rejects failed, pending, cancelled, neutral and unknown optional checks", () => {
  for (const conclusion of [
    "FAILURE",
    "CANCELLED",
    "TIMED_OUT",
    "ACTION_REQUIRED",
    "NEUTRAL",
    "UNKNOWN",
  ]) {
    expect(() =>
      assertMergeChecks(
        response([
          ...coreChecks(),
          check("Windows CEF persistence", conclusion),
        ]),
        "reviewed",
      ),
    ).toThrow("has not passed");
  }
  expect(() =>
    assertMergeChecks(
      response([
        ...coreChecks(),
        check("Windows CEF persistence", "", "IN_PROGRESS"),
      ]),
      "reviewed",
    ),
  ).toThrow("has not passed");
  expect(() =>
    assertMergeChecks(
      response([
        ...coreChecks(),
        { __typename: "StatusContext", context: "external", state: "PENDING" },
      ]),
      "reviewed",
    ),
  ).toThrow("has not passed");
});

test("rejects absent/skipped core checks, unreadable responses and changed heads", () => {
  for (const omitted of coreChecks()) {
    const rest = coreChecks().filter(({ name }) => name !== omitted.name);
    expect(() => assertMergeChecks(response(rest), "reviewed")).toThrow(
      "Required CI check",
    );
    expect(() =>
      assertMergeChecks(
        response([...rest, check(omitted.name, "SKIPPED")]),
        "reviewed",
      ),
    ).toThrow("Required CI check");
  }
  expect(() => assertMergeChecks(response([]), "reviewed")).toThrow(
    "no CI checks",
  );
  expect(() =>
    assertMergeChecks(response(coreChecks(), "new-head"), "reviewed"),
  ).toThrow("head changed");
  expect(() => assertMergeChecks("invalid", "reviewed")).toThrow();
});

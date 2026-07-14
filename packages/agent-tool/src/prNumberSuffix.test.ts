import { describe, expect, test } from "bun:test";

import {
  appendPrNumberSuffix,
  assertPrNumberSuffix,
  stripPrNumberSuffix,
} from "./prNumberSuffix";

describe("stripPrNumberSuffix", () => {
  test("removes a trailing reference and its leading space", () => {
    expect(stripPrNumberSuffix("feat(app): add widget (#1531)")).toBe(
      "feat(app): add widget",
    );
  });

  test("leaves a subject without a trailing reference unchanged", () => {
    expect(stripPrNumberSuffix("feat(app): add widget")).toBe(
      "feat(app): add widget",
    );
  });

  test("leaves a mid-subject reference intact", () => {
    expect(stripPrNumberSuffix("fix: revert change from (#12) rollout")).toBe(
      "fix: revert change from (#12) rollout",
    );
  });
});

describe("appendPrNumberSuffix", () => {
  test("appends the reference when absent", () => {
    expect(appendPrNumberSuffix("feat(app): add widget", "1531")).toBe(
      "feat(app): add widget (#1531)",
    );
  });

  test("is idempotent when the correct reference is already present", () => {
    expect(appendPrNumberSuffix("feat(app): add widget (#1531)", "1531")).toBe(
      "feat(app): add widget (#1531)",
    );
  });

  test("replaces a different trailing reference with the authoritative one", () => {
    expect(appendPrNumberSuffix("feat(app): add widget (#9999)", "1531")).toBe(
      "feat(app): add widget (#1531)",
    );
  });

  test("throws when the PR number is not a positive integer", () => {
    expect(() => appendPrNumberSuffix("feat(app): add widget", "")).toThrow(
      /Invalid PR number/,
    );
    expect(() => appendPrNumberSuffix("feat(app): add widget", "1a")).toThrow(
      /Invalid PR number/,
    );
  });
});

describe("assertPrNumberSuffix", () => {
  test("passes when the subject ends with the exact reference", () => {
    expect(() =>
      assertPrNumberSuffix("feat(app): add widget (#1531)", "1531"),
    ).not.toThrow();
  });

  test("throws when the reference is missing", () => {
    expect(() => assertPrNumberSuffix("feat(app): add widget", "1531")).toThrow(
      /must end with ' \(#1531\)'/,
    );
  });

  test("throws when the trailing reference is a different number", () => {
    expect(() =>
      assertPrNumberSuffix("feat(app): add widget (#9999)", "1531"),
    ).toThrow(/must end with/);
  });
});

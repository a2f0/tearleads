import { expect, test } from "bun:test";
import { PrincipalPolicyPageQuerySchema } from "./principalPolicyPageQuery";

test("principal history cursors are safe integers without a lifetime page cap", () => {
  for (const value of [0, 32, 16_384, Number.MAX_SAFE_INTEGER]) {
    for (const afterVersion of [value, String(value)]) {
      expect(PrincipalPolicyPageQuerySchema.parse({ afterVersion })).toEqual({
        afterVersion: value,
      });
    }
  }
  for (const afterVersion of [
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "01",
    "1e3",
    "",
    "-1",
    "0.5",
  ]) {
    expect(
      PrincipalPolicyPageQuerySchema.safeParse({ afterVersion }).success,
    ).toBe(false);
  }
  expect(
    PrincipalPolicyPageQuerySchema.safeParse({ stateHash: "a".repeat(64) })
      .success,
  ).toBe(true);
  expect(
    PrincipalPolicyPageQuerySchema.safeParse({ stateHash: "untrusted-head" })
      .success,
  ).toBe(false);
  expect(PrincipalPolicyPageQuerySchema.safeParse({ unknown: 1 }).success).toBe(
    false,
  );
});

test("a conditional read names a positive head version and an exact hash", () => {
  const ifStateHash = "b".repeat(64);
  expect(
    PrincipalPolicyPageQuerySchema.parse({ ifVersion: "3", ifStateHash }),
  ).toEqual({ ifVersion: 3, ifStateHash });
  for (const ifVersion of [0, "0", -1, "01", 1.5]) {
    expect(
      PrincipalPolicyPageQuerySchema.safeParse({ ifVersion, ifStateHash })
        .success,
    ).toBe(false);
  }
  expect(
    PrincipalPolicyPageQuerySchema.safeParse({
      ifVersion: 1,
      ifStateHash: "untrusted-head",
    }).success,
  ).toBe(false);
});

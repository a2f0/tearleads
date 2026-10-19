import { expect, test } from "bun:test";
import {
  PrincipalPolicyRefListSchema,
  PrincipalPolicyRefSchema,
} from "./principalPolicyRef";

const ref = {
  principalType: "group",
  principalId: "7d5c6b2e-4a1f-4c3d-9e8b-1a2b3c4d5e6f",
  version: 3,
  stateHash: "a".repeat(64),
};

test("a principal policy ref names a managed principal head", () => {
  expect(PrincipalPolicyRefSchema.safeParse(ref).success).toBe(true);
  expect(
    PrincipalPolicyRefSchema.safeParse({
      ...ref,
      principalType: "organization",
    }).success,
  ).toBe(true);
  for (const invalid of [
    { ...ref, principalType: "user" },
    { ...ref, principalId: "not-a-uuid" },
    { ...ref, version: 0 },
    { ...ref, version: 1.5 },
    { ...ref, stateHash: "" },
    { principalType: "group", principalId: ref.principalId, version: 3 },
  ]) {
    expect(PrincipalPolicyRefSchema.safeParse(invalid).success).toBe(false);
  }
});

test("a mutation cites at most 4,096 principal policy heads", () => {
  expect(
    PrincipalPolicyRefListSchema.safeParse(
      Array.from({ length: 4096 }, () => ref),
    ).success,
  ).toBe(true);
  expect(
    PrincipalPolicyRefListSchema.safeParse(
      Array.from({ length: 4097 }, () => ref),
    ).success,
  ).toBe(false);
});

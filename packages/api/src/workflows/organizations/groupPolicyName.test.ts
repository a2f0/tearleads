import { expect, test } from "bun:test";
import { assertCreatedGroupPolicyName } from "./groupPolicyName";

test("group creation refuses a non-JSON signed-name payload", () => {
  expect(() =>
    assertCreatedGroupPolicyName({
      ciphertext: Buffer.from("not JSON").toString("base64"),
      name: "Operators",
    }),
  ).toThrow("Group policy payload must commit its display name");
});

test.each([
  { payload: null },
  { payload: {} },
  { payload: [] },
  { payload: { name: "Other" } },
])("group creation refuses absent or mismatched names: %j", ({ payload }) => {
  expect(() =>
    assertCreatedGroupPolicyName({
      ciphertext: Buffer.from(JSON.stringify(payload)).toString("base64"),
      name: "Operators",
    }),
  ).toThrow("Group name must match the signed policy display name");
});

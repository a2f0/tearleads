import { expect, test } from "bun:test";
import {
  encodeBuiltinGroupMetadata,
  encryptGroupMetadata,
} from "@tearleads/crypto";
import { assertCreatedGroupPolicyName } from "./groupPolicyName";

const scope = { groupId: "group-1", organizationId: "org-1" };
test.each(
  [null, {}, [], { name: "Other" }, { members: [], name: "Operators" }].map(
    (payload) => ({ payload }),
  ),
)("legacy name payloads are refused: %j", ({ payload }) => {
  expect(() =>
    assertCreatedGroupPolicyName({
      ...scope,
      ciphertext: Buffer.from(JSON.stringify(payload)).toString("base64"),
    }),
  ).toThrow();
});
test("custom groups require encrypted metadata bound to their IDs", async () => {
  const ciphertext = await encryptGroupMetadata({
    key: {
      organizationId: scope.organizationId,
      containerId: "metadata",
      containerKeyEpochId: "epoch",
      keyMaterial: new Uint8Array(32).fill(7),
    },
    groupId: scope.groupId,
    name: "Operators",
  });
  expect(() =>
    assertCreatedGroupPolicyName({ ...scope, ciphertext }),
  ).not.toThrow();
  expect(() =>
    assertCreatedGroupPolicyName({ ...scope, groupId: "other", ciphertext }),
  ).toThrow();
  expect(() =>
    assertCreatedGroupPolicyName({
      ...scope,
      organizationId: "other",
      ciphertext,
    }),
  ).toThrow();
});
test("builtin roles are explicit and unavailable to custom groups", () => {
  const ciphertext = encodeBuiltinGroupMetadata("admins");
  expect(() =>
    assertCreatedGroupPolicyName({
      ...scope,
      ciphertext,
      builtinRole: "admins",
    }),
  ).not.toThrow();
  expect(() =>
    assertCreatedGroupPolicyName({
      ...scope,
      ciphertext,
      builtinRole: "members",
    }),
  ).toThrow();
  expect(() =>
    assertCreatedGroupPolicyName({ ...scope, ciphertext }),
  ).toThrow();
});

import { expect, test } from "bun:test";
import {
  SIGNED_GROUP_INVALID_PAYLOADS,
  SIGNED_GROUP_NAME_CASES,
} from "@tearleads/test-utils";
import { readSignedGroupPolicyName } from "./groupPolicyName";

test.each([
  ...SIGNED_GROUP_INVALID_PAYLOADS,
])("server rejects malformed signed-name encoding: %s", (ciphertext) => {
  expect(() => readSignedGroupPolicyName(ciphertext)).toThrow();
});

test.each([...SIGNED_GROUP_NAME_CASES])("server signed-name corpus: %j", ({
  name,
  allowed,
}) => {
  const ciphertext = Buffer.from(
    JSON.stringify(name === null ? {} : { name }),
  ).toString("base64");
  expect(readSignedGroupPolicyName(ciphertext)).toBe(allowed ? name : null);
});

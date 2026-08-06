import { expect, test } from "bun:test";
import {
  getPrincipalPolicyOperation,
  putPrincipalPolicyOperation,
} from "@tearleads/validators/operation";
import { getPrincipalPolicy, putPrincipalPolicy } from "./policy";

const principalId = "11111111-1111-4111-8111-111111111111";

test("principal policy client metadata derives from shared operations", () => {
  expect(getPrincipalPolicy).toMatchObject({
    method: getPrincipalPolicyOperation.method,
  });
  expect(putPrincipalPolicy).toMatchObject({
    method: putPrincipalPolicyOperation.method,
  });
  expect(getPrincipalPolicy.path("group", principalId)).toBe(
    `/principals/group/${principalId}/policy`,
  );
  expect(putPrincipalPolicy.path("organization", principalId)).toBe(
    `/principals/organization/${principalId}/policy`,
  );
  expect(getPrincipalPolicy.isResponse).toBeDefined();
  expect(putPrincipalPolicy.isRequest).toBeDefined();
  expect(putPrincipalPolicy.isResponse).toBeDefined();
  expect(() => getPrincipalPolicy.path("group", "invalid")).toThrow(
    "Invalid path parameters for principals.policy.get",
  );
});

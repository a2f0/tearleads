import { expect, test } from "bun:test";
import { ContainerMutationFailureResponseSchema } from "./containerMutationError";

test.each([
  {},
  { code: "principal_policy_stale", principalPolicies: [] },
])("every container failure branch requires a non-empty message (%j)", (fields) => {
  expect(
    ContainerMutationFailureResponseSchema.safeParse({ ...fields, error: "" })
      .success,
  ).toBe(false);
  expect(
    ContainerMutationFailureResponseSchema.safeParse({
      ...fields,
      error: "Refused",
    }).success,
  ).toBe(true);
});

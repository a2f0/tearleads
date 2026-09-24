import { expect, test } from "bun:test";
import { OrganizationPolicyHistoryResponseSchema } from "../response";
import { operationRequestPathWithQuery } from "./definition";
import { getOrganizationPolicyHistoryOperation } from "./organizationPolicyHistory";

test("history requests require an exact head and encode it as a query parameter", () => {
  const operation = getOrganizationPolicyHistoryOperation;
  expect(operation.auth).toBe("session");
  expect(operation.query.safeParse({}).success).toBe(false);
  expect(operation.query.safeParse({ stateHash: "" }).success).toBe(false);
  expect(
    operation.query.safeParse({ stateHash: "head", extra: true }).success,
  ).toBe(false);
  expect(
    operationRequestPathWithQuery(
      operation,
      { organizationId: "11111111-1111-4111-8111-111111111111" },
      { stateHash: "head+/=" },
    ),
  ).toBe(
    "/organizations/11111111-1111-4111-8111-111111111111/policy-history?stateHash=head%2B%2F%3D",
  );
});

test("history evidence must contain payload and public group snapshot arrays", () => {
  const response = {
    organizationId: "11111111-1111-4111-8111-111111111111",
    stateHash: "head",
    organizationPayloads: [],
    groups: [],
  };
  expect(
    OrganizationPolicyHistoryResponseSchema.safeParse(response).success,
  ).toBe(true);
  for (const invalid of [
    { ...response, organizationPayloads: null },
    { ...response, organizationPayloads: [{ stateHash: "head" }] },
    { ...response, groups: [{ currentState: {} }] },
    { ...response, stateHash: "" },
  ]) {
    expect(
      OrganizationPolicyHistoryResponseSchema.safeParse(invalid).success,
    ).toBe(false);
  }
});

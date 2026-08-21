import { expect, test } from "bun:test";
import { getOrganizationDataUsageOperation } from "@symcrypt/validators/operation";
import { getOrganizationDataUsage } from "./dataUsage";

const organizationId = "11111111-1111-4111-8111-111111111111";

test("organization data usage client metadata derives from the shared operation", () => {
  expect(getOrganizationDataUsage.method).toBe(
    getOrganizationDataUsageOperation.method,
  );
  expect(getOrganizationDataUsage.path(organizationId)).toBe(
    `/organizations/${organizationId}/data-usage`,
  );
  expect(getOrganizationDataUsage.isResponse).toBeDefined();
});

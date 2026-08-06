import { expect, test } from "bun:test";
import { createOrganizationOperation } from "@tearleads/validators/operation";
import { createOrganization } from "./create";

test("create organization client metadata derives from the shared operation", () => {
  expect(createOrganization).toMatchObject({
    method: createOrganizationOperation.method,
    path: "/organizations",
  });
  expect(createOrganization.isRequest).toBeDefined();
  expect(createOrganization.isResponse).toBeDefined();
});

import { expect } from "bun:test";
import type { TestUser } from "@tearleads/test-utils";
import { isOrganizationReadModelResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import { routeApp } from "../../src/routeApp";

export async function loadOrganizationReadModelSnapshot(
  actor: TestUser,
  organizationId: string,
) {
  const response = await routeApp.request(
    `/organizations/${organizationId}/read-model`,
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(
    isOrganizationReadModelResponse(body) && body.mode === "snapshot",
    "expected organization read-model snapshot",
  );
  return body;
}

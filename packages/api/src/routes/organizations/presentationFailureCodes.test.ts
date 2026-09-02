import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { ORGANIZATION_PRESENTATION_ERROR_CODES } from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("organization presentation denials carry the exact purge code", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const outsider = createTestUser();
  await registerUser(outsider);
  await authenticate(outsider);
  const organizationId = await getDefaultOrganizationId(owner.userId);

  for (const suffix of ["read-model", "data-usage"] as const) {
    const denied = await routeApp.request(
      `/organizations/${organizationId}/${suffix}`,
      { headers: { Authorization: `Bearer ${outsider.token}` } },
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      code: ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
      error: "Organization access denied",
    });

    const missing = await routeApp.request(
      `/organizations/${crypto.randomUUID()}/${suffix}`,
      { headers: { Authorization: `Bearer ${owner.token}` } },
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      code: ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
      error: "Organization not found",
    });
  }
});

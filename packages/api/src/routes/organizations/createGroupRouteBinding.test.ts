import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { getDefaultOrganizationId } from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

test.each([
  ["organization id", 400] as const,
  ["authenticated signer", 403] as const,
])("group creation binds the signed organization successor to the route %s", async (mismatch, expectedStatus) => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const groupId = crypto.randomUUID();
  const request = await createGroupRequest({
    actor,
    groupId,
    name: "Mismatched successor",
  });
  const differentId = crypto.randomUUID();
  const body =
    mismatch === "organization id"
      ? {
          ...request,
          organizationPolicy: {
            ...request.organizationPolicy,
            state: {
              ...request.organizationPolicy.state,
              principalId: differentId,
            },
          },
        }
      : {
          ...request,
          initialGroupPolicy: {
            ...request.initialGroupPolicy,
            state: {
              ...request.initialGroupPolicy.state,
              signerUserId: differentId,
            },
          },
          organizationPolicy: {
            ...request.organizationPolicy,
            state: {
              ...request.organizationPolicy.state,
              signerUserId: differentId,
            },
          },
        };

  const response = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(body),
    },
  );

  expect(response.status).toBe(expectedStatus);
  expect(
    await db
      .select({ groupId: groups.id })
      .from(groups)
      .where(eq(groups.id, groupId)),
  ).toEqual([]);
  expect(await getCurrentPrincipalState("group", groupId, db)).toBeNull();
});

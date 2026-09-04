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

test("group creation binds its listing name to the signed policy name", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const groupId = crypto.randomUUID();
  const request = await createGroupRequest({
    actor,
    groupId,
    name: "Operators",
  });
  const response = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({ ...request, name: "Executives" }),
    },
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Group name must match the signed policy display name",
  });
  expect(await getCurrentPrincipalState("group", groupId, db)).toBeNull();
  expect(await db.select().from(groups).where(eq(groups.id, groupId))).toEqual(
    [],
  );
});

test.each([
  [
    "organization id",
    400,
    "Principal state principalId does not match route principal",
  ] as const,
  [
    "group and organization signers",
    400,
    "Group and organization policies must have the same signer and organization scope",
  ] as const,
  [
    "initial group principal type",
    400,
    "Initial group policy must target a group principal",
  ] as const,
  [
    "organization principal type",
    400,
    "Group and organization policies must have the same signer and organization scope",
  ] as const,
  [
    "authenticated signer",
    403,
    "Principal policy signer does not match authenticated requester",
  ] as const,
])("group creation binds the signed organization successor to the route %s", async (mismatch, expectedStatus, expectedError) => {
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
  let body = request;
  if (mismatch === "organization id") {
    body = {
      ...request,
      organizationPolicy: {
        ...request.organizationPolicy,
        state: {
          ...request.organizationPolicy.state,
          principalId: differentId,
        },
      },
    };
  } else if (mismatch === "group and organization signers") {
    body = {
      ...request,
      initialGroupPolicy: {
        ...request.initialGroupPolicy,
        state: {
          ...request.initialGroupPolicy.state,
          signerUserId: differentId,
        },
      },
    };
  } else if (mismatch === "initial group principal type") {
    body = {
      ...request,
      initialGroupPolicy: {
        ...request.initialGroupPolicy,
        state: {
          ...request.initialGroupPolicy.state,
          principalType: "organization",
        },
      },
    };
  } else if (mismatch === "organization principal type") {
    body = {
      ...request,
      organizationPolicy: {
        ...request.organizationPolicy,
        state: {
          ...request.organizationPolicy.state,
          principalType: "group",
        },
      },
    };
  } else {
    body = {
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
  }

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
  expect(await response.json()).toEqual({ error: expectedError });
  expect(
    await db
      .select({ groupId: groups.id })
      .from(groups)
      .where(eq(groups.id, groupId)),
  ).toEqual([]);
  expect(await getCurrentPrincipalState("group", groupId, db)).toBeNull();
});

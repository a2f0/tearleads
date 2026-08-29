import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizationBilling,
  organizations,
  users,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { isCreateOrganizationResponse } from "@symcrypt/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";

test("replacement creation returns one winner to competing devices", async () => {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);
  const [registered] = await db
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(registered, "expected registered user");
  await db
    .update(organizationBilling)
    .set({ purgedAt: new Date(), status: "purged" })
    .where(
      eq(organizationBilling.organizationId, registered.defaultOrganizationId),
    );
  const firstBody = {
    ...(await createOrganizationRequestBody(user)),
    replacesOrganizationId: registered.defaultOrganizationId,
  };
  const secondBody = {
    ...(await createOrganizationRequestBody(user)),
    replacesOrganizationId: registered.defaultOrganizationId,
  };

  const firstResponse = await submitCreateOrganization(user, firstBody);
  expect(firstResponse.status).toBe(200);
  const winner: unknown = await firstResponse.json();
  invariant(isCreateOrganizationResponse(winner), "expected replacement");
  const secondResponse = await submitCreateOrganization(user, secondBody);
  expect(secondResponse.status).toBe(200);
  expect(await secondResponse.json()).toEqual(winner);
  expect(winner.organizationId).toBe(firstBody.organizationId);
  expect(
    await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, secondBody.organizationId)),
  ).toHaveLength(0);
});

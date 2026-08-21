import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizationGroupTombstones,
  organizations,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { eq } from "drizzle-orm";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { storePrincipalState } from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";

async function registeredActor() {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);
  return user;
}

async function expectOrganizationMissing(organizationId: string) {
  expect(
    await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId)),
  ).toEqual([]);
}

test("organization provisioning rejects a pre-staged group principal ID", async () => {
  const user = await registeredActor();
  const body = await createOrganizationRequestBody(user);
  await storePrincipalState(body.initialAdminGroup.initialGroupPolicy, db);

  const response = await submitCreateOrganization(user, body);
  expect(response.status).toBe(409);
  await expectOrganizationMissing(body.organizationId);
});

test("organization provisioning rejects a pre-staged organization principal ID", async () => {
  const user = await registeredActor();
  const body = await createOrganizationRequestBody(user);
  await storePrincipalState(body.initialOrganizationPolicy, db);

  const response = await submitCreateOrganization(user, body);
  expect(response.status).toBe(409);
  await expectOrganizationMissing(body.organizationId);
});

test("organization provisioning rejects a tombstoned reserved group ID", async () => {
  const user = await registeredActor();
  const body = await createOrganizationRequestBody(user);
  await db.insert(organizationGroupTombstones).values({
    groupId: body.initialMemberGroup.groupId,
    organizationId: body.organizationId,
  });

  const response = await submitCreateOrganization(user, body);
  expect(response.status).toBe(409);
  await expectOrganizationMissing(body.organizationId);
});

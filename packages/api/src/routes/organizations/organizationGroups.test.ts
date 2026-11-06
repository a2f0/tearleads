import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  groups as groupsTable,
  organizations,
} from "@tearleads/api-shared/schema";
import { toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestUser } from "@tearleads/test-utils";
import {
  isCreateOrganizationGroupResponse,
  isDeleteOrganizationGroupResponse,
  isOrganizationGroupMembersResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { addUserToAdminGroup } from "../../../test/helpers/organizationAdmin";
import {
  createGroupRequest,
  deleteGroupRequest,
} from "../../../test/helpers/organizationGroup";
import { loadOrganizationReadModelSnapshot } from "../../../test/helpers/organizationReadModel";
import { requestAfterPrincipalPreparation } from "../../../test/helpers/principalPreparationRequest";
import { registerAndAuthenticateWithOrganization } from "../../../test/helpers/registerUser";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

test("org manager routes let admins create empty externally-administered groups", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(actor);
  const groupId = crypto.randomUUID();

  const createResponse = await requestAfterPrincipalPreparation(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor,
          groupId,
          includeActorAsAdmin: false,
          name: "Operators",
        }),
      ),
    },
  );

  expect(createResponse.status).toBe(200);
  const createBody = await createResponse.json();
  invariant(
    isCreateOrganizationGroupResponse(createBody),
    "expected organization group summary response",
  );
  expect(createBody.group.groupId).toBe(groupId);
  expect(createBody.group).not.toHaveProperty("name");
  expect(createBody.group.isBuiltin).toBe(false);
  expect(createBody.group.currentState?.memberCount).toBe(0);

  const membersResponse = await routeApp.request(
    `/organizations/${organizationId}/groups/${groupId}/members`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  expect(membersResponse.status).toBe(200);
  const membersBody = await membersResponse.json();
  invariant(
    isOrganizationGroupMembersResponse(membersBody),
    "expected organization group members response",
  );
  expect(membersBody.members).toEqual([]);
});

test("org manager group creation rejects a stale signed Admins authority head", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(actor);
  const futureAdmin = createTestUser();
  await registerAndAuthenticateWithOrganization(futureAdmin);
  const groupId = crypto.randomUUID();
  const request = await createGroupRequest({
    actor,
    groupId,
    includeActorAsAdmin: false,
    name: "Stale authority",
  });
  await addUserToAdminGroup({
    actor,
    member: futureAdmin,
    organizationId,
  });

  const response = await requestAfterPrincipalPreparation(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(request),
    },
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Principal state signer must be an admin",
  });
  expect(
    await db
      .select({ groupId: groupsTable.id })
      .from(groupsTable)
      .where(eq(groupsTable.id, groupId)),
  ).toEqual([]);
  expect(await getCurrentPrincipalState("group", groupId, db)).toBeNull();
});

test("org manager routes create and list groups with members", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(actor);
  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization row");
  const groupId = crypto.randomUUID();

  const createResponse = await requestAfterPrincipalPreparation(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor,
          groupId,
          name: "Operators",
        }),
      ),
    },
  );

  expect(createResponse.status).toBe(200);
  const createBody = await createResponse.json();
  invariant(
    isCreateOrganizationGroupResponse(createBody),
    "expected organization group summary response",
  );
  expect(createBody.group.groupId).toBe(groupId);
  expect(createBody.group).not.toHaveProperty("name");
  expect(createBody.group.isBuiltin).toBe(false);
  expect(createBody.group.currentState?.memberCount).toBe(1);

  const listBody = (
    await loadOrganizationReadModelSnapshot(actor, organizationId)
  ).lanes.groups;
  expect(listBody.groups.map((group) => group.groupId)).toContain(groupId);
  expect(listBody.groups.every((group) => !("name" in group))).toBe(true);

  const membersResponse = await routeApp.request(
    `/organizations/${organizationId}/groups/${groupId}/members`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  expect(membersResponse.status).toBe(200);
  const membersBody = await membersResponse.json();
  invariant(
    isOrganizationGroupMembersResponse(membersBody),
    "expected organization group members response",
  );
  expect(membersBody.members).toEqual([
    {
      userId: actor.userId,
      role: "admin",
      signingKeyFingerprint: actor.fingerprint,
      signingPublicKey: bytesToBase64(actor.signing.signingPublicKey),
      encapsulationPublicKey: bytesToBase64(actor.kem.publicKey),
      encapsulationKeyFingerprint: await toFingerprint(actor.kem.publicKey),
    },
  ]);

  const builtinDeleteResponse = await deleteGroupRequest({
    actor,
    groupId: organization.adminGroupId,
    organizationId,
  });
  expect(builtinDeleteResponse.status).toBe(409);

  const deleteResponse = await deleteGroupRequest({
    actor,
    groupId,
    organizationId,
  });
  expect(deleteResponse.status).toBe(200);
  const deleteBody = await deleteResponse.json();
  invariant(
    isDeleteOrganizationGroupResponse(deleteBody),
    "expected delete organization group response",
  );
  expect(deleteBody).toEqual({
    deleted: true,
    groupId,
    organizationPolicy: expect.objectContaining({
      currentState: expect.objectContaining({
        principalId: organizationId,
        principalType: "organization",
      }),
    }),
    organizationId,
  });

  const postDeleteListBody = (
    await loadOrganizationReadModelSnapshot(actor, organizationId)
  ).lanes.groups;
  expect(
    postDeleteListBody.groups.map((deletedGroup) => deletedGroup.groupId),
  ).not.toContain(groupId);
});

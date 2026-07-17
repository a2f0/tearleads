import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import {
  isOrganizationGroupSummaryResponse,
  isOrganizationReadModelResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { addUserToAdminGroup } from "../../../test/helpers/organizationAdmin";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { addMemberGroupUser } from "../../../test/helpers/organizationMember";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";
import { encodeOrganizationReadModelCursor } from "../../workflows/organizations/readModelCursor";

async function registerAndAuthenticate(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);

  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(row, "expected registered user row");
  return row.organizationId;
}

function readModelPath(organizationId: string, cursor?: string): string {
  const path = `/organizations/${organizationId}/read-model`;
  return cursor === undefined
    ? path
    : `${path}?${new URLSearchParams({ cursor }).toString()}`;
}

test("organization read-model route snapshots and coalesces group changes", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);

  const snapshotResponse = await routeApp.request(
    readModelPath(organizationId),
    {
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  expect(snapshotResponse.status).toBe(200);
  expect(snapshotResponse.headers.get("Cache-Control")).toBe(
    "private, no-store",
  );
  const snapshot = await snapshotResponse.json();
  invariant(
    isOrganizationReadModelResponse(snapshot) && snapshot.mode === "snapshot",
    "expected organization read-model snapshot",
  );
  expect(snapshot.lanes.directory.users.map((user) => user.userId)).toEqual([
    actor.userId,
  ]);
  expect(snapshot.currentUser.isOrgAdmin).toBe(true);
  expect(Reflect.has(snapshot.lanes.directory, "currentUser")).toBe(false);
  expect(snapshot.lanes.groups.groups.map((group) => group.name)).toEqual([
    "Admins",
  ]);

  const unchangedResponse = await routeApp.request(
    readModelPath(organizationId, snapshot.nextCursor),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const unchanged = await unchangedResponse.json();
  invariant(
    isOrganizationReadModelResponse(unchanged) && unchanged.mode === "delta",
    "expected empty organization read-model delta",
  );
  expect(unchanged.lanes).toEqual({});
  expect(unchanged.currentUser.isOrgAdmin).toBe(true);
  expect(unchanged.nextCursor).toBe(snapshot.nextCursor);

  const groupId = crypto.randomUUID();
  const groupRequest = await createGroupRequest({
    actor,
    groupId,
    name: "Operators",
  });
  const createResponse = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(groupRequest),
    },
  );
  const created = await createResponse.json();
  invariant(
    isOrganizationGroupSummaryResponse(created),
    "expected created organization group",
  );

  const changedResponse = await routeApp.request(
    readModelPath(organizationId, snapshot.nextCursor),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const changed = await changedResponse.json();
  invariant(
    isOrganizationReadModelResponse(changed) && changed.mode === "delta",
    "expected organization read-model delta",
  );
  expect(changed.lanes.directory).toBeUndefined();
  expect(changed.lanes.groups?.groups.map((group) => group.name)).toEqual([
    "Admins",
    "Operators",
  ]);

  const rejectedReplay = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(groupRequest),
    },
  );
  expect(rejectedReplay.status).toBe(409);
  const afterRejectedResponse = await routeApp.request(
    readModelPath(organizationId, changed.nextCursor),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const afterRejected = await afterRejectedResponse.json();
  invariant(
    isOrganizationReadModelResponse(afterRejected) &&
      afterRejected.mode === "delta",
    "expected delta after rejected group replay",
  );
  expect(afterRejected.lanes).toEqual({});

  const deleteResponse = await routeApp.request(
    `/organizations/${organizationId}/groups/${groupId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${actor.token}` } },
  );
  expect(deleteResponse.status).toBe(200);
  const deletedDeltaResponse = await routeApp.request(
    readModelPath(organizationId, changed.nextCursor),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const deletedDelta = await deletedDeltaResponse.json();
  invariant(
    isOrganizationReadModelResponse(deletedDelta) &&
      deletedDelta.mode === "delta",
    "expected group deletion delta",
  );
  expect(deletedDelta.lanes.groups?.groups.map((group) => group.name)).toEqual([
    "Admins",
  ]);
});

test("Admins changes invalidate directory state for an existing member", async () => {
  const owner = createTestUser();
  const organizationId = await registerAndAuthenticate(owner);
  const member = createTestUser();
  await registerAndAuthenticate(member);
  await addMemberGroupUser({
    actor: owner,
    memberUserId: member.userId,
    organizationId,
  });

  const initialResponse = await routeApp.request(
    readModelPath(organizationId),
    {
      headers: { Authorization: `Bearer ${member.token}` },
    },
  );
  const initial = await initialResponse.json();
  invariant(
    isOrganizationReadModelResponse(initial) && initial.mode === "snapshot",
    "expected existing member snapshot",
  );
  expect(initial.currentUser.isOrgAdmin).toBe(false);

  await addUserToAdminGroup({ actor: owner, member, organizationId });

  const deltaResponse = await routeApp.request(
    readModelPath(organizationId, initial.nextCursor),
    { headers: { Authorization: `Bearer ${member.token}` } },
  );
  const delta = await deltaResponse.json();
  invariant(
    isOrganizationReadModelResponse(delta) && delta.mode === "delta",
    "expected Admins membership delta",
  );
  expect(delta.currentUser.isOrgAdmin).toBe(true);
  expect(
    delta.lanes.directory && Reflect.has(delta.lanes.directory, "currentUser"),
  ).toBe(false);
  expect(delta.lanes.groups).toBeDefined();
});

test("organization read-model route validates cursor scope after access", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const other = createTestUser();
  const otherOrganizationId = await registerAndAuthenticate(other);

  const invalidCursorResponse = await routeApp.request(
    readModelPath(organizationId, ""),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  expect(invalidCursorResponse.status).toBe(400);

  const crossOrganizationResponse = await routeApp.request(
    readModelPath(
      organizationId,
      encodeOrganizationReadModelCursor(otherOrganizationId, 0n),
    ),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  expect(crossOrganizationResponse.status).toBe(400);

  const outsiderResponse = await routeApp.request(
    readModelPath(organizationId, "malformed"),
    { headers: { Authorization: `Bearer ${other.token}` } },
  );
  expect(outsiderResponse.status).toBe(403);

  const missingResponse = await routeApp.request(
    readModelPath(crypto.randomUUID()),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  expect(missingResponse.status).toBe(404);
});

test("no-op organization profile writes do not advance the read model", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const initialResponse = await routeApp.request(
    readModelPath(organizationId),
    {
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  const initial = await initialResponse.json();
  invariant(
    isOrganizationReadModelResponse(initial),
    "expected initial organization read model",
  );

  for (const path of [
    `/organizations/${organizationId}/roster/${actor.userId}`,
    `/organizations/${organizationId}/profile`,
  ]) {
    const response = await routeApp.request(path, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({ profileDocumentId: null }),
    });
    expect(response.status).toBe(200);
  }

  const deltaResponse = await routeApp.request(
    readModelPath(organizationId, initial.nextCursor),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const delta = await deltaResponse.json();
  invariant(
    isOrganizationReadModelResponse(delta) && delta.mode === "delta",
    "expected organization read-model delta",
  );
  expect(delta.lanes).toEqual({});
  expect(delta.nextCursor).toBe(initial.nextCursor);
});

test("an ahead organization read-model cursor requests a reset snapshot", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  const response = await routeApp.request(
    readModelPath(
      organizationId,
      encodeOrganizationReadModelCursor(organizationId, 99n),
    ),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const body = await response.json();

  invariant(
    isOrganizationReadModelResponse(body),
    "expected organization read-model response",
  );
  expect(body.mode).toBe("snapshot");
});

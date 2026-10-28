import { afterEach, expect, test } from "bun:test";
import type { Device } from "../harness/device";
import { expectNoSecurityIncidents } from "../harness/expectations";
import type { ObservedRequest } from "../harness/transport";
import { type User, World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

function device(user: User): Device {
  const first = user.devices[0];
  if (!first) throw new Error(`${user.name} has no device`);
  return first;
}

async function directoryOf(admin: User) {
  const directory =
    await device(admin).sdk.organizations.loadDirectoryAndGroups();
  if (!directory) throw new Error(`${admin.name} has no directory`);
  return directory;
}

async function shownLeaveRequest(admin: User, member: User) {
  const { directory } = await directoryOf(admin);
  const user = directory.users.find(
    (candidate) => candidate.userId === member.userId,
  );
  if (!user) throw new Error(`${member.name} is not in the directory`);
  return user.leaveRequest;
}

async function askToLeave(member: User, organizationId: string) {
  const result = await device(
    member,
  ).sdk.organizations.memberships.setLeaveRequested(organizationId, true);
  expect(result.status).toBe("updated");
}

async function removeFromMembers(admin: User, member: User) {
  const actor = device(admin);
  const { memberGroupId } = await directoryOf(admin);
  await actor.sdk.organizations.removeUserFromGroup({
    expectedGroupName: "Members",
    groupId: memberGroupId,
    removedUserId: member.userId,
  });
  await actor.idle();
  await actor.sdk.organizations.loadDirectoryAndGroupsAfterMutation();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readModelOf(organizationId: string) {
  return (request: ObservedRequest) =>
    request.method === "GET" &&
    request.path.endsWith(`/organizations/${organizationId}/read-model`);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? Reflect.get(value, key) : undefined;
}

/** The read model with `request` served as `userId`'s pending request. */
function servingLeaveRequest(body: unknown, userId: string, request: unknown) {
  const directory = field(field(body, "lanes"), "directory");
  const users = field(directory, "users");
  if (!isRecord(directory) || !Array.isArray(users)) return body;
  Reflect.set(
    directory,
    "users",
    users.map((user: unknown) =>
      isRecord(user) && field(user, "userId") === userId
        ? { ...user, leaveRequest: request }
        : user,
    ),
  );
  return body;
}

// Bob asks to leave Alice's organization. Carol's removal rotates the Members
// key without ending Bob's membership, so his request stands: Alice's device
// walks verified Members history back to the head he cited. Alice then
// removes Bob, which clears the request, and later adds him back. A server
// that serves Bob's request again cannot make it look current: the history
// Alice verifies shows his removal after the head it cites.
test("a leave request outlives other removals but not its own membership", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const carol = await world.register("carol");
  for (const member of [bob, carol]) {
    await world.addToOrganization(alice, member);
  }
  const organizationId = device(alice).organizationId;

  await askToLeave(bob, organizationId);
  const filed = await shownLeaveRequest(alice, bob);
  if (!filed) throw new Error("Alice does not see Bob's request");

  await removeFromMembers(alice, carol);
  expect(await shownLeaveRequest(alice, bob)).toEqual(filed);

  await removeFromMembers(alice, bob);
  let replaying = true;
  device(alice).transport.rewriteResponses(
    readModelOf(organizationId),
    (body) => (replaying ? servingLeaveRequest(body, bob.userId, filed) : body),
  );
  await world.addToOrganization(alice, bob);
  expect(await shownLeaveRequest(alice, bob)).toBeNull();

  // Once Bob asks again, his new request cites his current membership.
  replaying = false;
  await askToLeave(bob, organizationId);
  const renewed = await shownLeaveRequest(alice, bob);
  expect(renewed).not.toBeNull();
  expect(renewed?.membersHead.version).toBeGreaterThan(
    filed.membersHead.version,
  );
  expectNoSecurityIncidents(world);
}, 300_000);

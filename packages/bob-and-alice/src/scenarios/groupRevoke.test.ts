import { afterEach, expect, test } from "bun:test";
import {
  expectAccess,
  expectNoSecurityIncidents,
} from "../harness/expectations";
import { trace } from "../harness/trace";
import { type Folder, type User, World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

function epochsOf(current: World, actor: User, path: readonly Folder[]) {
  return Promise.all(path.map((folder) => current.keyEpoch(actor, folder)));
}

// Unsharing a folder from a group rotates it under the group's next policy,
// with a deeper direct grant two levels down, so the commit must carry the
// level between. The group's member loses the folder; the direct grantee
// keeps its own and repairs it with its next write, from the device that held
// the path before the revoke.
test("a group revoke above a deeper direct grant carries the level between", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const dave = await world.register("dave");
  for (const member of [bob, dave]) {
    await world.addToOrganization(alice, member);
  }

  const a = await world.createFolder(alice, world.root(alice), "a");
  const b = await world.createFolder(alice, a, "b");
  const c = await world.createFolder(alice, b, "c");
  const upper = await world.createDocument(alice, b, "upper v1");
  const lower = await world.createDocument(alice, c, "lower v1");
  const team = await world.createGroup(alice, "Team");
  await world.addToGroup(alice, team, bob);
  await world.shareWithUser(alice, c, dave);
  await world.shareWithGroup(alice, a, team, "write");
  await world.editDocument(bob, upper, "upper v2 bob");
  await expectAccess(world, upper);
  await expectAccess(world, lower);

  const path = [a, b, c];
  const before = await epochsOf(world, alice, path);
  await world.revoke(alice, a, team);
  const after = await epochsOf(world, alice, path);
  trace(`a b c epochs ${before} -> ${after}`);
  expect(after).toEqual(
    before.map((epoch, level) => (level < 2 ? epoch + 1 : epoch)),
  );

  await world.editDocument(alice, upper, "upper v3 after the team left");
  await world.editDocument(bob, upper, "bob after the team lost a");
  await world.editDocument(dave, lower, "lower v2 dave");
  await world.newDevice(bob);
  await expectAccess(world, upper);
  await expectAccess(world, lower);
  expectNoSecurityIncidents(world);
}, 300_000);

// One group granted on `a` (write) and `c` (read). Unsharing either grant
// rotates it and re-signs the other in the same commit; the member keeps
// exactly what the remaining grant reaches.
test.each([
  ["the upper grant", "upper"],
  ["the lower grant", "lower"],
])(
  "revoking %s of a group granted at two levels",
  async (_, revoked) => {
    world = await World.create();
    const alice = await world.register("alice");
    const bob = await world.register("bob");
    await world.addToOrganization(alice, bob);

    const a = await world.createFolder(alice, world.root(alice), "a");
    const b = await world.createFolder(alice, a, "b");
    const c = await world.createFolder(alice, b, "c");
    const upper = await world.createDocument(alice, b, "upper v1");
    const lower = await world.createDocument(alice, c, "lower v1");
    const team = await world.createGroup(alice, "Team");
    await world.addToGroup(alice, team, bob);
    await world.shareWithGroup(alice, a, team, "write");
    await world.shareWithGroup(alice, c, team, "read");
    await expectAccess(world, upper);
    await expectAccess(world, lower);

    const path = [a, b, c];
    const before = await epochsOf(world, alice, path);
    await world.revoke(alice, revoked === "upper" ? a : c, team);
    trace(`a b c epochs ${before} -> ${await epochsOf(world, alice, path)}`);

    await world.editDocument(alice, upper, "upper v2 alice");
    await world.editDocument(alice, lower, "lower v2 alice");
    await world.editDocument(bob, upper, "upper bob after the revoke");
    await world.editDocument(bob, lower, "lower bob after the revoke");
    await world.newDevice(bob);
    await expectAccess(world, upper);
    await expectAccess(world, lower);
    expectNoSecurityIncidents(world);
  },
  300_000,
);

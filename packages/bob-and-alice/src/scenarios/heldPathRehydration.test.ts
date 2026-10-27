import { afterEach, expect, test } from "bun:test";
import {
  expectAccess,
  expectNoSecurityIncidents,
} from "../harness/expectations";
import { trace } from "../harness/trace";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

// root -> a -> b -> c. Every device reads both documents, then `a` rotates
// three times, under a revoke, a group shrink, and a second revoke, while no
// writer touches the tree. Each writer then writes from the path it held
// before the first rotation: the API refuses the stale path, and the device
// refetches, repairs what it may, and commits without anyone else's help.
test("writers holding a path from before several rotations rehydrate and write", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const carol = await world.register("carol");
  const dave = await world.register("dave");
  const erin = await world.register("erin");
  const frank = await world.register("frank");
  for (const member of [bob, carol, dave, erin, frank]) {
    await world.addToOrganization(alice, member);
  }

  const a = await world.createFolder(alice, world.root(alice), "a");
  const b = await world.createFolder(alice, a, "b");
  const c = await world.createFolder(alice, b, "c");
  const upper = await world.createDocument(alice, b, "upper v1");
  const lower = await world.createDocument(alice, c, "lower v1");
  const team = await world.createGroup(alice, "Team");
  await world.addToGroup(alice, team, bob);
  await world.addToGroup(alice, team, carol);
  // Direct shares first: a share right after a group share races the SDK's
  // background re-cite (#2647).
  await world.shareWithUser(alice, c, dave);
  await world.shareWithUser(alice, a, erin);
  await world.shareWithUser(alice, a, frank);
  await world.shareWithGroup(alice, a, team, "write");
  await expectAccess(world, upper);
  await expectAccess(world, lower);

  const path = [a, b, c];
  const epochs = async () =>
    Promise.all(path.map((folder) => world?.keyEpoch(alice, folder) ?? 0));
  const before = await epochs();
  await world.revoke(alice, a, erin);
  await world.removeFromGroup(alice, team, carol);
  await world.revoke(alice, a, frank);
  const afterRotations = await epochs();
  trace(`a b c epochs ${before} -> ${afterRotations}`);
  // `a` and `b` rotate with each change; `c` waits for its grantee.
  expect(afterRotations).toEqual(
    before.map((epoch, level) => (level < 2 ? epoch + 3 : epoch)),
  );

  await world.editDocument(dave, lower, "lower v2 dave");
  await world.editDocument(bob, upper, "upper v2 bob");
  await world.editDocument(bob, lower, "lower v3 bob");
  await world.editDocument(carol, upper, "carol after leaving the team");
  await world.editDocument(erin, lower, "erin after her revoke");
  expect(await epochs()).toEqual(
    afterRotations.map((epoch, level) => (level < 2 ? epoch : epoch + 1)),
  );
  for (const user of [alice, carol, dave, erin, frank]) {
    await world.newDevice(user);
  }
  await expectAccess(world, upper);
  await expectAccess(world, lower);
  expectNoSecurityIncidents(world);
}, 300_000);

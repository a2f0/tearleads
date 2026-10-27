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

// root -> a -> b -> c -> d, with a group and a user on `a` and a direct grant
// on `c`. A revoke on `a` must carry `b`'s rekey and leave `c`'s grantee able
// to write below it, and a later move of `c` out from under `a` must take the
// group's access with it. `groupShrinkCarry` shrinks a group on this shape.
test("grants at two levels of a deep tree survive a shrink and a subtree move", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const carol = await world.register("carol");
  const dave = await world.register("dave");
  const erin = await world.register("erin");
  for (const member of [bob, carol, dave, erin]) {
    await world.addToOrganization(alice, member);
  }

  const a = await world.createFolder(alice, world.root(alice), "a");
  const b = await world.createFolder(alice, a, "b");
  const c = await world.createFolder(alice, b, "c");
  const d = await world.createFolder(alice, c, "d");
  const elsewhere = await world.createFolder(alice, world.root(alice), "e");
  const upper = await world.createDocument(alice, b, "upper v1");
  const lower = await world.createDocument(alice, d, "lower v1");
  const team = await world.createGroup(alice, "Team");
  await world.addToGroup(alice, team, bob);
  await world.addToGroup(alice, team, carol);
  // Direct shares first: a share right after a group share races the SDK's
  // background re-cite (#2647).
  await world.shareWithUser(alice, c, dave);
  await world.shareWithUser(alice, a, erin);
  await world.shareWithGroup(alice, a, team, "write");
  await expectAccess(world, upper);
  await expectAccess(world, lower);

  const path = [a, b, c, d];
  const epochs = async () =>
    Promise.all(path.map((folder) => world?.keyEpoch(alice, folder) ?? 0));
  const before = await epochs();
  await world.revoke(alice, a, erin);
  const afterRevoke = await epochs();
  trace(`a b c d epochs ${before} -> ${afterRevoke}`);
  // Exactly `a` and the level above the directly granted `c` rotate; `c`
  // and `d` are left for their grantee to repair.
  expect(afterRevoke).toEqual(
    before.map((epoch, level) => (level < 2 ? epoch + 1 : epoch)),
  );

  // The grantee repairs its own subtree without anyone else's help. A fresh
  // install writes: a device that synced before the revoke never repairs
  // (#2648; see knownIssues.test.ts).
  const daveFresh = await world.newDevice(dave);
  await world.editDocument(
    dave,
    lower,
    "lower v2 dave after the revoke",
    daveFresh,
  );
  const afterRepair = await epochs();
  trace(`a b c d epochs after the grantee's write ${afterRepair}`);
  expect(afterRepair).toEqual(
    afterRevoke.map((epoch, level) => (level < 2 ? epoch : epoch + 1)),
  );
  await world.editDocument(bob, upper, "upper v2 bob after the revoke");
  for (const user of [bob, dave, erin]) await world.newDevice(user);
  await expectAccess(world, upper);
  await expectAccess(world, lower);

  // Moving `c` out from under `a` removes the group's path to `lower`.
  await world.moveFolder(alice, c, elsewhere);
  await world.editDocument(alice, lower, "lower v3 after c left a");
  await world.editDocument(dave, lower, "lower v4 dave after the move");
  await world.newDevice(bob);
  await expectAccess(world, upper);
  await expectAccess(world, lower);
  expectNoSecurityIncidents(world);
}, 300_000);

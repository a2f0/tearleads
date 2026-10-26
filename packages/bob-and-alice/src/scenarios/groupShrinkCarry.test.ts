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

// root -> a -> b -> c -> d, with a group on `a` and a direct grant on `c`.
// Removing a member rotates `a` under the group's successor key, and the
// policy commit must carry `b`'s rekey under it before the server accepts it
// (#2646). `c` and `d` are left for their grantee to repair.
test("a group shrink above a deeper direct grant carries the level between", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const carol = await world.register("carol");
  const dave = await world.register("dave");
  const erin = await world.register("erin");
  for (const member of [carol, dave, erin]) {
    await world.addToOrganization(alice, member);
  }

  const a = await world.createFolder(alice, world.root(alice), "a");
  const b = await world.createFolder(alice, a, "b");
  const c = await world.createFolder(alice, b, "c");
  const d = await world.createFolder(alice, c, "d");
  const upper = await world.createDocument(alice, b, "upper v1");
  const lower = await world.createDocument(alice, d, "lower v1");
  const team = await world.createGroup(alice, "Team");
  await world.addToGroup(alice, team, carol);
  await world.addToGroup(alice, team, erin);
  // Direct shares first: a share right after a group share races the SDK's
  // background re-cite (#2647).
  await world.shareWithUser(alice, c, dave);
  await world.shareWithGroup(alice, a, team, "write");
  await world.editDocument(carol, upper, "upper v2 carol");
  await expectAccess(world, upper);
  await expectAccess(world, lower);

  const path = [a, b, c, d];
  const before = await epochsOf(world, alice, path);
  await world.removeFromGroup(alice, team, carol);
  const afterShrink = await epochsOf(world, alice, path);
  trace(`a b c d epochs ${before} -> ${afterShrink}`);
  expect(afterShrink).toEqual(
    before.map((epoch, level) => (level < 2 ? epoch + 1 : epoch)),
  );

  await world.editDocument(erin, upper, "upper v3 erin after carol left");
  await world.editDocument(carol, upper, "carol after leaving the team");
  const daveFresh = await world.newDevice(dave);
  await world.editDocument(dave, lower, "lower v2 dave", daveFresh);
  expect(await epochsOf(world, alice, path)).toEqual(
    afterShrink.map((epoch, level) => (level < 2 ? epoch : epoch + 1)),
  );
  for (const user of [carol, erin]) await world.newDevice(user);
  await expectAccess(world, upper);
  await expectAccess(world, lower);
  expectNoSecurityIncidents(world);
}, 300_000);

// One group granted at two levels of a chain, write on `a` and read on `c`,
// in either order. Each share re-cites the other grant under the head the
// same commit advances, and a shrink rotates `a`, carries `b` without being
// told, and rematerializes `c` under the carried `b`, all in one commit. The
// second share and the shrink run on fresh installs of the admin, which hold
// no pin for the containers the batch re-signs.
test.each([
  ["the lower grant first", true],
  ["the upper grant first", false],
])(
  "a group granted at two levels of one chain, %s, shrinks in one commit",
  async (_, lowerFirst) => {
    world = await World.create();
    const alice = await world.register("alice");
    const bob = await world.register("bob");
    const carol = await world.register("carol");
    for (const member of [bob, carol]) {
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
    const [first, second] = lowerFirst ? [c, a] : [a, c];
    const level = (folder: Folder) => (folder === a ? "write" : "read");
    await world.shareWithGroup(alice, first, team, level(first));
    const sharer = await world.newDevice(alice);
    await world.shareWithGroup(alice, second, team, level(second), sharer);
    await expectAccess(world, upper);
    await expectAccess(world, lower);

    const path = [a, b, c];
    const before = await epochsOf(world, alice, path);
    const shrinker = await world.newDevice(alice);
    await world.removeFromGroup(alice, team, carol, shrinker);
    const afterShrink = await epochsOf(world, alice, path);
    trace(`a b c epochs ${before} -> ${afterShrink}`);
    expect(afterShrink).toEqual(before.map((epoch) => epoch + 1));

    await world.editDocument(bob, upper, "upper v2 bob");
    await world.editDocument(bob, lower, "lower v2 bob");
    await world.newDevice(bob);
    await world.newDevice(carol);
    await expectAccess(world, upper);
    await expectAccess(world, lower);
    expectNoSecurityIncidents(world);
  },
  300_000,
);

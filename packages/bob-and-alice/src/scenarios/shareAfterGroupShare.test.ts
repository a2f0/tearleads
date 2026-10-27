import { afterEach, test } from "bun:test";
import {
  expectAccess,
  expectNoSecurityIncidents,
} from "../harness/expectations";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

// A group share on `a` schedules this device's background re-citation of the
// held `b` and `c`, which advances their heads while a user share of `c` may
// already be in flight. The share is planned again from a fresh projection
// rather than failing (#2647). The race is timing-dependent, so the scenario
// runs it on several fresh chains.
test("a user share right after a group share above it lands", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const dave = await world.register("dave");
  for (const member of [bob, dave]) {
    await world.addToOrganization(alice, member);
  }
  const team = await world.createGroup(alice, "Team");
  await world.addToGroup(alice, team, bob);

  for (let chain = 1; chain <= 6; chain += 1) {
    const a = await world.createFolder(alice, world.root(alice), `a${chain}`);
    const b = await world.createFolder(alice, a, `b${chain}`);
    const c = await world.createFolder(alice, b, `c${chain}`);
    const document = await world.createDocument(alice, c, `v1 chain ${chain}`);
    await world.shareWithGroup(alice, a, team, "write");
    await world.shareWithUser(alice, c, dave);
    await world.editDocument(dave, document, `v2 dave on chain ${chain}`);
    await world.editDocument(bob, document, `v3 bob on chain ${chain}`);
    await expectAccess(world, document);
  }
  expectNoSecurityIncidents(world);
}, 300_000);

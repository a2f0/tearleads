import { expect, test } from "bun:test";
import { readText } from "../harness/documentReads";
import { World } from "../harness/world";

// Each test here reproduces an open issue and is marked `failing`, so it
// passes while the bug stands and fails once it is fixed: convert it into an
// ordinary scenario then.

test.failing("#2648: a writer whose device synced before an ancestor revoke", async () => {
  const world = await World.create();
  try {
    const alice = await world.register("alice");
    const dave = await world.register("dave");
    const erin = await world.register("erin");
    await world.addToOrganization(alice, dave);
    await world.addToOrganization(alice, erin);
    const a = await world.createFolder(alice, world.root(alice), "a");
    const b = await world.createFolder(alice, a, "b");
    const c = await world.createFolder(alice, b, "c");
    const document = await world.createDocument(alice, c, "v1");
    await world.shareWithUser(alice, c, dave);
    await world.shareWithUser(alice, a, erin);
    const [daveDevice] = dave.devices;
    if (!daveDevice) throw new Error("dave has no device");
    expect(await readText(daveDevice, world.documentRef(document))).toBe("v1");
    // Rotates `a`, carries `b`, and leaves `c` for Dave to repair inline.
    await world.revoke(alice, a, erin);
    await world.editDocument(dave, document, "v2 dave");
    const [aliceDevice] = alice.devices;
    if (!aliceDevice) throw new Error("alice has no device");
    expect(await readText(aliceDevice, world.documentRef(document))).toBe(
      "v2 dave",
    );
  } finally {
    world.dispose();
  }
}, 120_000);

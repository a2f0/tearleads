import { afterEach, expect, test } from "bun:test";
import { readDocument, readText } from "../harness/documentReads";
import {
  expectAccess,
  expectNoSecurityIncidents,
} from "../harness/expectations";
import { documentWrite } from "../harness/transport";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

test("two first writers after revocation retry a stale write and preserve both edits", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const carol = await world.register("carol");
  const dave = await world.register("dave");
  for (const member of [bob, carol, dave])
    await world.addToOrganization(alice, member);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "seed\n");
  for (const member of [bob, carol, dave])
    await world.shareWithUser(alice, folder, member);
  await expectAccess(world, document);
  const owner = alice.devices[0];
  const first = bob.devices[0];
  const second = carol.devices[0];
  const removed = dave.devices[0];
  if (!owner || !first || !second || !removed)
    throw new Error("Expected original devices");
  const firstStore = await readDocument(first, world.documentRef(document));
  const secondStore = await readDocument(second, world.documentRef(document));
  if (!firstStore || !secondStore)
    throw new Error("Expected both held editors");
  const before = await world.contentKeyEpoch(alice, document);
  await world.revoke(alice, folder, dave);
  const firstGate = first.transport.hold(
    "before-request",
    documentWrite(document.documentId),
  );
  const secondGate = second.transport.hold(
    "before-request",
    documentWrite(document.documentId),
  );
  await Promise.all([
    firstStore.setText("seed\nbob\n"),
    secondStore.setText("seed\ncarol\n"),
  ]);
  await Promise.all([firstGate.wait(), secondGate.wait()]);
  firstGate.release();
  await first.idle();
  expect(await readText(owner, world.documentRef(document))).toBe(
    "seed\nbob\n",
  );
  expect(world.model.edit(document.documentId, bob.userId, "seed\nbob\n")).toBe(
    true,
  );
  expect(await readText(removed, world.documentRef(document))).toBe("seed\n");

  secondGate.release();
  await second.idle();
  expect((await secondGate.wait()).status).toBe(409);
  const merged = await readText(owner, world.documentRef(document));
  if (merged === null) throw new Error("Expected merged text");
  expect(["seed\nbob\ncarol\n", "seed\ncarol\nbob\n"]).toContain(merged);
  expect(world.model.edit(document.documentId, carol.userId, merged)).toBe(
    true,
  );
  expect(await world.contentKeyEpoch(alice, document)).toBeGreaterThan(before);
  for (const user of [alice, bob, carol, dave]) await world.newDevice(user);
  await expectAccess(world, document);
  expectNoSecurityIncidents(world);
}, 180_000);

import { afterEach, expect, test } from "bun:test";
import { readText } from "../harness/documentReads";
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

test.each(["share", "revoke"] as const)(
  "a stale %s retries and preserves exactly the concurrent grant changes",
  async (operation) => {
    world = await World.create();
    const alice = await world.register("alice");
    const bob = await world.register("bob");
    const carol = await world.register("carol");
    for (const member of [bob, carol])
      await world.addToOrganization(alice, member);
    const folder = await world.createFolder(alice, world.root(alice), "Shared");
    const document = await world.createDocument(alice, folder, "before revoke");
    await world.shareWithUser(alice, folder, bob);
    await expectAccess(world, document);
    const original = alice.devices[0];
    const removed = bob.devices[0];
    if (!original || !removed) throw new Error("Expected original devices");
    const other = await world.newDevice(alice);
    await other.holdFolder(folder.id);
    const beforeMutation = original.transport.history.length;
    const held = original.transport.hold(
      "before-request",
      (request) =>
        request.method === "POST" &&
        request.path.endsWith(`/containers/${folder.id}/${operation}`),
    );
    const mutation = (
      operation === "share"
        ? world.shareWithUser(alice, folder, carol)
        : world.revoke(alice, folder, bob)
    ).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
    await held.wait();
    if (operation === "share") {
      await world.revoke(alice, folder, bob, other);
      await world.editDocument(
        alice,
        document,
        "after revoke before share",
        other,
      );
      expect(await readText(removed, world.documentRef(document))).toBe(
        "before revoke",
      );
    } else {
      await world.shareWithUser(alice, folder, carol, other);
    }
    held.release();
    expect(await mutation).toEqual({ ok: true });
    expect((await held.wait()).status).toBe(409);
    expect(
      original.transport.history
        .slice(beforeMutation)
        .filter(
          (request) =>
            request.method === "POST" &&
            request.path.endsWith(`/containers/${folder.id}/${operation}`),
        )
        .map(({ status }) => status),
    ).toEqual([409, 200]);
    await world.editDocument(carol, document, "carol after raced share");
    await world.newDevice(bob);
    await world.newDevice(carol);
    await expectAccess(world, document);
    expectNoSecurityIncidents(world);
  },
  180_000,
);

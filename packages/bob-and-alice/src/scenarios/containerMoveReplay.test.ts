import { afterEach, expect, test } from "bun:test";
import {
  expectAccess,
  expectNoSecurityIncidents,
} from "../harness/expectations";
import type { ObservedRequest } from "../harness/transport";
import { until } from "../harness/until";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

function isMoveOf(folderId: string) {
  return (request: ObservedRequest) =>
    request.method === "POST" &&
    request.path === `/containers/${folderId}/move`;
}

async function hasPendingContainerMove(
  device: NonNullable<World["allUsers"][number]["devices"][number]>,
  folderId: string,
): Promise<boolean> {
  const pending = await device.sdk.containerContents
    .documentQueries()
    .listPendingWrites();
  return pending.some(
    (item) =>
      item.objectKind === "container" &&
      item.localId === folderId &&
      item.operations.some((op) => op.kind === "move"),
  );
}

// A queued container move commits on the API and rotates the folder key once,
// then its HTTP response is lost before the device receives it. When the
// restarted device replays the queued move, it verifies the folder's writer
// projection first, observes that the verified head already sits under the
// destination, and settles the local intent without posting a second move or
// rotating the folder key a second time.
test("a lost container move response settles from the verified head without a second rotation", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);

  const shared = await world.createFolder(alice, world.root(alice), "Shared");
  const archive = await world.createFolder(alice, world.root(alice), "Archive");
  const child = await world.createFolder(alice, shared, "Child");
  const document = await world.createDocument(alice, child, "v1 before move");
  await world.shareWithUser(alice, shared, bob);
  await expectAccess(world, document);

  const aliceDevice = alice.devices[0];
  if (!aliceDevice) throw new Error("Expected Alice's device");
  const epochBefore = await world.keyEpoch(alice, child);

  // Hold the real move response after the API commits it, then drop it so the
  // device keeps its move intent queued locally.
  const lost = aliceDevice.transport.hold("after-response", isMoveOf(child.id));
  const tree = await aliceDevice.tree();
  const moveQueued = await tree.moveContainer(child.id, archive.id);
  expect(moveQueued).not.toBeNull();
  const committed = await lost.wait();
  expect(committed.status).toBe(200);
  aliceDevice.setOnline(false);
  lost.drop();
  await aliceDevice.idle();

  expect(await hasPendingContainerMove(aliceDevice, child.id)).toBe(true);
  // Check the API's committed key epoch from a fresh observer so Alice's
  // offline device stays untouched until restart.
  const observer = await world.newDevice(alice);
  const epochAfterCommit = await (async () => {
    const info = await observer.sdk.containerContents.loadContainerInfo({
      containerId: child.id,
      remoteInfoMode: "always",
    });
    const epoch = info.remoteInfo?.security?.currentContainerKeyEpoch;
    if (epoch === undefined) throw new Error("Expected committed key epoch");
    return epoch;
  })();
  expect(epochAfterCommit).toBe(epochBefore + 1);
  world.model.moveContainer(child.id, archive.id);

  // Restart Alice's device online: the structural lane replays the queued move,
  // verifies the committed head under Archive, and settles with zero extra move
  // POSTs and zero extra key rotations.
  const beforeRestart = aliceDevice.transport.history.length;
  const restarted = await world.restartDevice(alice, aliceDevice);
  const restartedTree = await restarted.tree();
  restartedTree.requestSync();
  await until(
    async () => !(await hasPendingContainerMove(restarted, child.id)),
    "replayed container move intent to settle",
  );
  await restarted.idle();

  expect(
    restarted.transport.history.slice(beforeRestart).filter(isMoveOf(child.id)),
  ).toEqual([]);
  expect(await world.keyEpoch(alice, child)).toBe(epochAfterCommit);
  expect(
    restartedTree.getSnapshot().nodes.find((node) => node.id === child.id)
      ?.parentId,
  ).toBe(archive.id);

  // Post-move edits remain confidential from Bob and readable on every Alice device.
  await world.editDocument(alice, document, "v2 after move", restarted);
  await world.newDevice(bob);
  await expectAccess(world, document);
  expectNoSecurityIncidents(world);
}, 240_000);

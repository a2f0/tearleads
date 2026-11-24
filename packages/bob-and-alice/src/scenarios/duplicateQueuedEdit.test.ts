import { afterEach, expect, test } from "bun:test";
import { readDocument } from "../harness/documentReads";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

/**
 * Two quick edits on an open document, then a restart that stops the sync
 * pass the first edit started. The device goes offline first, but the open
 * store keeps its online runtime unless `storeKnowsOffline`, so that pass
 * runs beside the second edit, as it would on a connected device. Returns
 * the restarted device's queue.
 */
async function twoEditsThenRestart(storeKnowsOffline: boolean) {
  world = await World.create();
  const alice = await world.register("alice");
  const root = world.root(alice);
  const document = await world.createDocument(alice, root, "seed\n");
  const [device] = alice.devices;
  if (!device) throw new Error("Expected Alice's device");
  const store = await readDocument(device, world.documentRef(document));
  if (!store) throw device.failure("cannot open the document");
  device.setOnline(false);
  if (storeKnowsOffline) {
    store.updateRuntime(device.sdk.documents.workflowRuntime(root.id));
  }
  await store.setText("seed\nfirst\n");
  await store.setText("seed\nfirst\nsecond\n");
  const restarted = await world.restartDevice(alice, device, false);
  return restarted.queuedDocumentUpdates(document.documentId);
}

// The pass lists the queue before the second edit's row commits and reads
// the document after that edit applied, so it exports the edit's operations
// again. Its enqueue finds the local row holding the same bytes, under the
// lock that inserts, and queues nothing; before #3230 the restart left a
// third row repeating the second.
test("a sync pass racing the second edit queues it once", async () => {
  const queued = await twoEditsThenRestart(false);
  expect(queued).toHaveLength(2);
  const [first, second] = queued;
  expect(second?.updateData).not.toBe(first?.updateData);
}, 120_000);

test("control: a store that knows it is offline queues each edit once", async () => {
  expect(await twoEditsThenRestart(true)).toHaveLength(2);
}, 120_000);

import { afterEach, expect, test } from "bun:test";
import {
  type CompletedDownloadItem,
  getDomainDownloadHistorySnapshot,
} from "@tearleads/client-sdk";
import type { Device } from "../harness/device";
import { expectAccess } from "../harness/expectations";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

function completedDownloads(
  device: Device,
): ReadonlyArray<CompletedDownloadItem> {
  return getDomainDownloadHistorySnapshot(
    device.sdk.runtime.input().state.domainScope,
  ).completed;
}

// The SDK records each finished download as it lands, as the coordinator
// records lane runs, so the history needs no host watching the queue.
test("a fresh install records the folder and document it downloads", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const trips = await world.createFolder(alice, world.root(alice), "Trips");
  const notes = await world.createDocument(alice, trips, "Trip notes");
  const [author] = alice.devices;
  if (!author) throw new Error("alice has no device");

  const fresh = await world.newDevice(alice);
  await fresh.holdFolder(trips.id);
  await expectAccess(world, notes);
  await fresh.idle();

  const downloaded = completedDownloads(fresh);
  expect(downloaded).toContainEqual(
    expect.objectContaining({
      localId: trips.id,
      objectKind: "container",
      title: "Trips",
    }),
  );
  expect(downloaded).toContainEqual(
    expect.objectContaining({
      containerId: trips.id,
      documentId: notes.documentId,
      objectKind: "document",
      title: "Trip notes",
    }),
  );
  // The install that wrote them downloaded neither.
  expect(
    completedDownloads(author).filter(
      (item) =>
        item.localId === trips.id || item.documentId === notes.documentId,
    ),
  ).toEqual([]);
});

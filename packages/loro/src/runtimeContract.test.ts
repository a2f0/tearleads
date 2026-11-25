// Behavior of the pinned Loro runtime that document sync is built on. A Loro
// upgrade that changes one of these needs the sync code read against it
// before the pin moves.
import { expect, test } from "bun:test";
import { VersionVector } from "loro-crdt";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  importSnapshot,
  importUpdates,
} from "./document";

const LARGE_INSERT_CHARACTERS = 512 * 1024;
// Loro 1.16.4 took about 3.7 s here and 1.19.1 takes about 5 ms (#3196).
const LARGE_INSERT_IMPORT_LIMIT_MS = 1000;

test("one large text insert imports into a non-empty document in bounded time", async () => {
  const base = await createDocument("large-insert-base");
  base.getText("text").insert(0, "x".repeat(1000));
  base.commit();
  const snapshot = exportFullHistorySnapshot(base);
  const writer = await createDocument("large-insert-writer");
  importSnapshot(writer, snapshot);
  const before = encodeVersionVector(writer);
  writer.getText("text").insert(500, "y".repeat(LARGE_INSERT_CHARACTERS));
  writer.commit();
  const update = exportUpdatesSince(writer, before);
  const reader = await createDocument("large-insert-reader");
  importSnapshot(reader, snapshot);

  const started = performance.now();
  importUpdates(reader, [update]);
  const elapsed = performance.now() - started;

  expect(reader.getText("text").length).toBe(1000 + LARGE_INSERT_CHARACTERS);
  expect(elapsed).toBeLessThan(LARGE_INSERT_IMPORT_LIMIT_MS);
  base.free();
  writer.free();
  reader.free();
});

test("an update left pending under a document's own peer refuses its writes until it takes a fresh peer", async () => {
  const device = await createDocument("pending-own-peer");
  device.getText("text").insert(0, "mine");
  device.commit();
  const missing = await createDocument("pending-missing-dependency");
  missing.getText("text").insert(0, "dep");
  missing.commit();
  // Another holder writes on the device's peer, on top of operations the
  // device lacks.
  const forger = await createDocument("pending-own-peer");
  importSnapshot(forger, exportFullHistorySnapshot(device));
  importUpdates(forger, [exportUpdatesSince(missing)]);
  const before = encodeVersionVector(forger);
  forger.getText("text").insert(0, "forged");
  forger.commit();
  const parked = exportUpdatesSince(forger, before);

  // The raw import leaves the update pending; `importUpdates` would throw.
  const status = device.import(parked);
  expect(status.pending).toBeInstanceOf(Object);
  expect(device.getText("text").toString()).toBe("mine");
  expect(() => {
    device.getText("text").insert(0, "x");
    device.commit();
  }).toThrow("Concurrent ops with the same peer id is not allowed");

  device.setPeerId("77");
  device.getText("text").insert(0, "y");
  device.commit();
  expect(device.getText("text").toString()).toBe("ymine");
  expect(
    device.oplogVersion().compare(
      VersionVector.parseJSON(
        new Map([
          [device.peerIdStr, 1],
          [forger.peerIdStr, 4],
        ]),
      ),
    ),
  ).toBe(0);
  device.free();
  missing.free();
  forger.free();
});

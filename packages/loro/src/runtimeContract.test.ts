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
  LoroReusedOperationIdError,
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
  expect(status.pending?.size).toBeGreaterThan(0);
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

test.each([
  ["before", true],
  ["after", false],
])(
  "a blob refused for a reused id leaves nothing pending, with the reuse %s a change whose dependency is missing",
  async (_order, reuseFirst) => {
    const held = await createDocument("refused-blob-held");
    held.getText("text").insert(0, "aaaa");
    held.commit();
    const missing = await createDocument("refused-blob-missing");
    missing.getText("text").insert(0, "dep");
    missing.commit();
    // One blob: other content under the held peer's ids, and a change by a
    // third peer on top of operations the holder lacks.
    const forger = await createDocument("refused-blob-held");
    const reuse = () => {
      forger.setPeerId(held.peerIdStr);
      forger.getText("text").insert(0, "bbbb");
      forger.commit();
    };
    const dependOnMissing = () => {
      importUpdates(forger, [exportUpdatesSince(missing)]);
      forger.setPeerId("4242");
      forger.getText("text").insert(0, "parked");
      forger.commit();
    };
    for (const write of reuseFirst
      ? [reuse, dependOnMissing]
      : [dependOnMissing, reuse]) {
      write();
    }
    const blob = exportUpdatesSince(forger, encodeVersionVector(missing));
    const before = encodeVersionVector(held);

    expect(() => importUpdates(held, [blob])).toThrow(
      LoroReusedOperationIdError,
    );
    expect(encodeVersionVector(held)).toBe(before);
    expect(held.exportPendingUpdates()).toBeUndefined();

    // The dependency arriving later brings nothing of the refused blob.
    importUpdates(held, [exportUpdatesSince(missing)]);
    expect(held.oplogVersion().get("4242")).toBeUndefined();
    expect(held.getText("text").toString()).not.toContain("parked");
    held.free();
    missing.free();
    forger.free();
  },
);

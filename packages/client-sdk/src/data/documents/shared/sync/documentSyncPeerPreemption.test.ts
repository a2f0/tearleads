import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getUpdateVersionVectors,
  importSnapshot,
} from "@tearleads/loro";
import { validateDocumentSyncUpdateImports } from "./documentSyncImportVerdicts";
import type { DecryptedDocumentSyncUpdate } from "./documentSyncTypes";

const FORGED = "550e8400-e29b-41d4-a716-446655440c01";

function decrypted(id: string, data: Uint8Array): DecryptedDocumentSyncUpdate {
  return { id, ...getUpdateVersionVectors(data), updateData: data };
}

/**
 * A device that wrote "victim" under its own peer, and an update another
 * writer forged under that same peer at the device's next counters, holding
 * other operations than the device then wrote there.
 */
async function preemptedDevice(seed: string) {
  const device = await createDocument(seed);
  device.getText("text").update("base");
  device.commit();
  const base = exportFullHistorySnapshot(device);
  const forger = await createDocument(seed);
  importSnapshot(forger, base);
  const before = encodeVersionVector(forger);
  forger.getText("text").insert(4, " forged");
  forger.commit();
  const forged = exportUpdatesSince(forger, before);
  forger.free();
  device.getText("text").insert(4, " victim");
  device.commit();
  return { device, forged: decrypted(FORGED, forged) };
}

test("an update that reuses this device's own operation ids with other operations names the device's peer", async () => {
  const { device, forged } = await preemptedDevice("preempted-victim");
  try {
    const verdicts = await validateDocumentSyncUpdateImports({
      currentDocument: device,
      decryptedUpdates: [forged],
    });
    expect(verdicts.voided.map((entry) => entry.updateId)).toEqual([FORGED]);
    expect(verdicts.voided[0]?.stage).toBe("loro_import");
    expect(verdicts.voided[0]?.preemptedPeerId).toBe(device.peerIdStr);
  } finally {
    device.free();
  }
});

test("a collision on another writer's operation ids names no peer of this device", async () => {
  // The device only holds the other writer's operations, imported earlier.
  const { device: writer, forged } = await preemptedDevice("preempted-other");
  const reader = await createDocument("preempted-reader");
  importSnapshot(reader, exportFullHistorySnapshot(writer));
  writer.free();
  try {
    const verdicts = await validateDocumentSyncUpdateImports({
      currentDocument: reader,
      decryptedUpdates: [forged],
    });
    expect(verdicts.voided.map((entry) => entry.updateId)).toEqual([FORGED]);
    expect(verdicts.voided[0]?.preemptedPeerId).toBeUndefined();
  } finally {
    reader.free();
  }
});

import { expect, test } from "bun:test";
import { createDocument, importUpdates } from "@symcrypt/loro";
import {
  advancePendingBaseVersion,
  pendingDeltaSinceBase,
} from "./persistence";
import type { DocumentStoreState } from "./state";

function markerState(): DocumentStoreState {
  return { pendingBaseVersion: null } as unknown as DocumentStoreState;
}

test("a delta orphaned by a failed enqueue is recovered by the next edit", async () => {
  const doc = await createDocument("durability-writer");
  const state = markerState();
  // Initialization seeds the marker to the (empty) starting version.
  advancePendingBaseVersion(state, doc);

  // Edit A is applied to the doc, but its enqueue "fails": we deliberately do
  // NOT advance the marker, mirroring the writeChain catch path.
  doc.getText("text").update("A");
  const orphanedDelta = pendingDeltaSinceBase(state, doc);
  expect(orphanedDelta.byteLength).toBeGreaterThan(0);

  // Edit B is applied next. Because the marker still points before A, the delta
  // exported here covers BOTH A and B.
  doc.getText("text").update("AB");
  const recoveryDelta = pendingDeltaSinceBase(state, doc);

  // A fresh peer that receives only the recovery delta must converge to "AB",
  // proving the orphaned "A" ops were folded back in rather than lost from sync.
  const peer = await createDocument("durability-peer");
  importUpdates(peer, [recoveryDelta]);
  expect(peer.getText("text").toString()).toBe("AB");
});

test("on success the marker advances so the next delta stays incremental", async () => {
  const doc = await createDocument("durability-writer-2");
  const state = markerState();
  advancePendingBaseVersion(state, doc);

  doc.getText("text").update("first");
  const firstDelta = pendingDeltaSinceBase(state, doc);
  advancePendingBaseVersion(state, doc); // enqueue + persist succeeded

  doc.getText("text").update("first second");
  const secondDelta = pendingDeltaSinceBase(state, doc);

  // A peer applying first then second converges.
  const peer = await createDocument("durability-peer-2");
  importUpdates(peer, [firstDelta]);
  expect(peer.getText("text").toString()).toBe("first");
  importUpdates(peer, [secondDelta]);
  expect(peer.getText("text").toString()).toBe("first second");

  // The second delta is genuinely incremental: applied alone to a fresh peer it
  // cannot converge, because it omits the causally-prior "first" ops.
  const freshPeer = await createDocument("durability-peer-3");
  expect(() => importUpdates(freshPeer, [secondDelta])).toThrow(
    "unresolved pending dependencies",
  );
  expect(freshPeer.getText("text").toString()).toBe("");
});

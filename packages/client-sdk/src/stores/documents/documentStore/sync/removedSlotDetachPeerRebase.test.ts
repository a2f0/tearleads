import { expect, test } from "bun:test";
import {
  bindingFor,
  runDetachPass,
  withRemovedSlotDetachHarness,
} from "../../../../../test/helpers/stores/removedSlotDetachHarness";
import { liveDocumentView } from "../../../../../test/helpers/stores/syncedDocumentView";
import { removeAttachmentFromDocumentStore } from "../attachments/attachmentRemoval";
import { setDocumentText } from "../mutations";
import type { DocumentStoreState } from "../state";
import { documentStorePeerRebaser } from "./peerRebase";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

const SLOT_ID = "contact-photos:portrait";
const IMPORTED = bindingFor(SLOT_ID);

/** The pass's rebase hook over the store's current document. */
function rebaser(state: DocumentStoreState) {
  const { doc, record } = state;
  const generation = captureDocumentStoreSyncGeneration(state, doc);
  if (!doc || !record || !generation) throw new Error("Expected a ready store");
  const rebase = documentStorePeerRebaser({
    currentDoc: doc,
    currentRecord: record,
    generation,
    state,
  });
  if (!rebase) throw new Error("Expected the SQL adapter to install rebases");
  return rebase;
}

test("a peer rebase keeps the slots a store saw recorded, so a restart still detaches a removed one", async () => {
  await withRemovedSlotDetachHarness(async (harness) => {
    harness.bound.set(SLOT_ID, IMPORTED);
    const before = await harness.open([SLOT_ID]);
    // An unsent edit on the record peer, which another user then owns from
    // counter 0: the refusal moves the edit onto a fresh peer.
    await setDocumentText(before, () => undefined, "edited");
    const recordPeer = before.doc?.peerIdStr;
    if (!recordPeer) throw new Error("Expected a loaded document");
    expect(
      await rebaser(before)([{ committedEndCounter: 0, peerId: recordPeer }]),
    ).toBe("rebased");
    expect(before.doc?.peerIdStr).not.toBe(recordPeer);

    // Removed before any detach pass, then a restart: the fresh store never
    // sees the slot recorded, only the removal.
    await removeAttachmentFromDocumentStore(before, () => undefined, SLOT_ID);
    const restarted = await harness.reopen();
    expect(liveDocumentView(restarted.doc).slotIds.has(SLOT_ID)).toBe(false);
    await runDetachPass(restarted);
    expect(harness.detachRequests).toHaveLength(1);
    expect(harness.detachRequests[0]).toMatchObject({
      body: { bindingId: IMPORTED.bindingId, slotId: SLOT_ID },
    });
  });
}, 20_000);

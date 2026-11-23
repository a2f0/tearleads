import { expect, test } from "bun:test";
import {
  bindingFor,
  runDetachPass,
  withRemovedSlotDetachHarness,
} from "../../../../../test/helpers/stores/removedSlotDetachHarness";
import { liveDocumentView } from "../../../../../test/helpers/stores/syncedDocumentView";
import { removeAttachmentFromDocumentStore } from "../attachments/attachmentRemoval";

const SLOT_ID = "contact-photos:portrait";
const IMPORTED = bindingFor(SLOT_ID);

test("a store opened after a restart detaches a slot an earlier store saw recorded", async () => {
  await withRemovedSlotDetachHarness(async (harness) => {
    harness.bound.set(SLOT_ID, IMPORTED);
    const before = await harness.open([SLOT_ID]);
    // Removed before the importer's binding arrived: no bytes, no marker.
    await removeAttachmentFromDocumentStore(before, () => undefined, SLOT_ID);

    // A restart before any detach pass: the fresh store never sees the slot
    // recorded, only the removal.
    const restarted = await harness.reopen();
    const view = liveDocumentView(restarted.doc);
    expect(view.slotIds.has(SLOT_ID)).toBe(false);
    await runDetachPass(restarted);
    expect(harness.detachRequests).toHaveLength(1);
    expect(harness.detachRequests[0]).toMatchObject({
      body: { bindingId: IMPORTED.bindingId, slotId: SLOT_ID },
      documentVersionVector: view.versionVector,
    });

    // Settled durably: a store opened after another restart lists nothing.
    const listings = harness.listings;
    await runDetachPass(await harness.reopen());
    expect(harness.detachRequests).toHaveLength(1);
    expect(harness.listings).toBe(listings);
  });
}, 20_000);

test("a refusal waits in memory only, so a restart sends its detach once more", async () => {
  await withRemovedSlotDetachHarness(async (harness) => {
    harness.bound.set(SLOT_ID, IMPORTED);
    harness.refused.add(IMPORTED.bindingId);
    const before = await harness.open([SLOT_ID]);
    await removeAttachmentFromDocumentStore(before, () => undefined, SLOT_ID);
    await runDetachPass(before);
    expect(harness.detachRequests).toHaveLength(1);

    const restarted = await harness.reopen();
    await runDetachPass(restarted);
    expect(harness.detachRequests).toHaveLength(2);
    // The second refusal waits in this store as the first did.
    await runDetachPass(restarted);
    expect(harness.detachRequests).toHaveLength(2);
  });
}, 20_000);

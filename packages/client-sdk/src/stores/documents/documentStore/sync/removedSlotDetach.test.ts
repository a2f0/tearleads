import { expect, test } from "bun:test";
import {
  bindingFor,
  runDetachPass,
  withRemovedSlotDetachHarness,
} from "../../../../../test/helpers/stores/removedSlotDetachHarness";
import { liveDocumentView } from "../../../../../test/helpers/stores/syncedDocumentView";
import { removeDocumentAttachment } from "../../../../data/documents/documentContent";
import { removeAttachmentFromDocumentStore } from "../attachments/attachmentRemoval";
import type { DocumentState, DocumentStoreState } from "../state";

const SLOT_ID = "contact-photos:portrait";
const IMPORTED = bindingFor(SLOT_ID);

function editDocument(state: DocumentStoreState) {
  state.doc?.getText("refused-detach-edit").insert(0, "edit");
  state.doc?.commit();
}

test("a store that saw a slot recorded detaches the binding its removal left", async () => {
  await withRemovedSlotDetachHarness(async (harness) => {
    harness.bound.set(SLOT_ID, IMPORTED);
    const state = await harness.open([SLOT_ID]);
    expect(state.attachmentStorageKeyBySlotId[SLOT_ID]).toBeUndefined();
    // Removed before the importer's binding arrived: no bytes, no marker.
    await removeAttachmentFromDocumentStore(state, () => undefined, SLOT_ID);
    const view = liveDocumentView(state.doc);
    expect(view.slotIds.has(SLOT_ID)).toBe(false);

    await runDetachPass(state);
    expect(harness.detachRequests).toHaveLength(1);
    expect(harness.detachRequests[0]).toMatchObject({
      body: { bindingId: IMPORTED.bindingId, slotId: SLOT_ID },
      documentVersionVector: view.versionVector,
    });

    // Settled: a later pass lists nothing for the slot and sends nothing.
    await runDetachPass(state);
    expect(harness.detachRequests).toHaveLength(1);
  });
}, 20_000);

test("a store that never saw the slot recorded leaves its binding", async () => {
  await withRemovedSlotDetachHarness(async (harness) => {
    harness.bound.set(SLOT_ID, IMPORTED);
    // This client never parsed the slot, e.g. one a newer client records.
    const state = await harness.open([]);
    await runDetachPass(state);
    expect(harness.detachRequests).toEqual([]);
  });
}, 20_000);

test("a reader that saw the slot removed leaves its binding to a writer", async () => {
  await withRemovedSlotDetachHarness(async (harness) => {
    harness.bound.set(SLOT_ID, IMPORTED);
    const state = await harness.open([SLOT_ID], [], "read");
    // A pulled removal, here applied to the live document directly.
    removeDocumentAttachment(state.doc as DocumentState, SLOT_ID);
    state.doc?.commit();

    await runDetachPass(state);
    expect(harness.detachRequests).toEqual([]);
    expect(harness.listings).toBe(0);
  });
}, 20_000);

test("a refused detach waits for a newer version and asks for a pull", async () => {
  await withRemovedSlotDetachHarness(async (harness) => {
    harness.bound.set(SLOT_ID, IMPORTED);
    const state = await harness.open([SLOT_ID]);
    await removeAttachmentFromDocumentStore(state, () => undefined, SLOT_ID);
    harness.refused.add(IMPORTED.bindingId);
    const signal = state.remoteUpdateSignalSeq;

    await runDetachPass(state);
    expect(harness.detachRequests).toHaveLength(1);
    expect(state.remoteUpdateSignalSeq).toBe(signal + 1);

    // The pull brought nothing: the same view lists nothing and sends no
    // second detach.
    const listings = harness.listings;
    await runDetachPass(state);
    expect(harness.detachRequests).toHaveLength(1);
    expect(harness.listings).toBe(listings);

    // A newer version, still without the slot, is tried once more.
    editDocument(state);
    harness.refused.clear();
    await runDetachPass(state);
    expect(harness.detachRequests).toHaveLength(2);
    expect(harness.detachRequests[1]?.documentVersionVector).toBe(
      liveDocumentView(state.doc).versionVector,
    );
  });
}, 20_000);

test("a held copy's refused detach waits without holding up the next marker", async () => {
  const [first, second] = ["a-slot", "b-slot"];
  if (!first || !second) throw new Error("Expected two slots");
  await withRemovedSlotDetachHarness(async (harness) => {
    for (const slotId of [first, second]) {
      harness.bound.set(slotId, bindingFor(slotId));
    }
    const state = await harness.open([first, second], [first, second]);
    expect(state.attachmentStorageKeyBySlotId[first]).toBeDefined();
    await removeAttachmentFromDocumentStore(state, () => undefined, first);
    await removeAttachmentFromDocumentStore(state, () => undefined, second);
    harness.refused.add(bindingFor(first).bindingId);
    const detachedBindings = () =>
      harness.detachRequests.map(
        (request) => (request.body as { bindingId: string }).bindingId,
      );

    // The first marker's refusal leaves it waiting, and the second detaches.
    await runDetachPass(state);
    expect(detachedBindings()).toEqual([
      bindingFor(first).bindingId,
      bindingFor(second).bindingId,
    ]);
    expect([...harness.bound.keys()]).toEqual([first]);

    // At the same version the first still waits and sends nothing.
    await runDetachPass(state);
    expect(harness.detachRequests).toHaveLength(2);

    // A newer version sends the waiting detach again.
    editDocument(state);
    harness.refused.clear();
    await runDetachPass(state);
    expect(harness.bound.size).toBe(0);
    expect(harness.detachRequests.at(-1)?.documentVersionVector).toBe(
      liveDocumentView(state.doc).versionVector,
    );
  });
}, 20_000);

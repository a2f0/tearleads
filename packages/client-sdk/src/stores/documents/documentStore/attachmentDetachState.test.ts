import { expect, test } from "bun:test";
import { createDocument } from "@symcrypt/loro";
import {
  addDocumentAttachments,
  ensureDocumentAttachmentStructure,
} from "../../../data/documents/documentContent";
import type { LocalAttachmentRecord } from "../../../workflows/documents";
import {
  reconcileLocalAttachmentDetachState,
  withLocalAttachmentDetachState,
} from "./attachmentDetachState";

const DETACHED_AT = "2026-07-26T00:00:00.000Z";

async function createDocumentWithSlots(slotIds: ReadonlyArray<string>) {
  const doc = await createDocument("attachment-detach-state-test");
  ensureDocumentAttachmentStructure(doc);
  addDocumentAttachments(
    doc,
    slotIds.map((slotId) => ({
      byteLength: 12,
      mimeType: "image/png",
      name: `${slotId}.png`,
      slotId,
    })),
  );
  return doc;
}

function createLocalAttachment(
  slotId: string,
  detachedAt: string | null = null,
): LocalAttachmentRecord {
  return {
    blobId: `blob-${slotId}`,
    byteLength: 12,
    detachedAt,
    localId: "local-document-1",
    mimeType: "image/png",
    slotId,
    storageKey: `storage-${slotId}`,
  };
}

test("withLocalAttachmentDetachState detaches slots the document dropped", async () => {
  const doc = await createDocumentWithSlots(["slot-live"]);

  const written = withLocalAttachmentDetachState(
    [
      createLocalAttachment("slot-live"),
      // The settled upload (or finished hydration) of a slot the user unlinked
      // while it was in flight: saving it as-is would clear its detach marker.
      createLocalAttachment("slot-unlinked"),
    ],
    doc,
  );

  expect(
    written.map((attachment) => [
      attachment.slotId,
      attachment.detachedAt === null,
    ]),
  ).toEqual([
    ["slot-live", true],
    ["slot-unlinked", false],
  ]);
  expect(written[1]?.detachedAt).toBeString();
});

test("withLocalAttachmentDetachState keeps an existing marker and passes through without a document", async () => {
  const doc = await createDocumentWithSlots(["slot-live"]);
  const alreadyDetached = createLocalAttachment("slot-live", "2026-01-01");

  expect(
    withLocalAttachmentDetachState([alreadyDetached], doc)[0]?.detachedAt,
  ).toBe("2026-01-01");
  expect(
    withLocalAttachmentDetachState([createLocalAttachment("slot-any")], null)[0]
      ?.detachedAt,
  ).toBeNull();
});

test("reconcileLocalAttachmentDetachState reports only rows that disagree with the document", async () => {
  const doc = await createDocumentWithSlots(["slot-live", "slot-stale-marker"]);

  const healed = reconcileLocalAttachmentDetachState(
    [
      createLocalAttachment("slot-live"),
      // Marked detached, but the document kept the slot: the removal stopped
      // between marking the row and persisting the document.
      createLocalAttachment("slot-stale-marker", DETACHED_AT),
      // Dropped from the document while its row stayed live.
      createLocalAttachment("slot-missing-marker"),
    ],
    doc,
  );

  expect(
    healed.map((attachment) => [
      attachment.slotId,
      attachment.detachedAt === null,
    ]),
  ).toEqual([
    ["slot-stale-marker", true],
    ["slot-missing-marker", false],
  ]);
  expect(healed[1]?.detachedAt).toBeString();
});

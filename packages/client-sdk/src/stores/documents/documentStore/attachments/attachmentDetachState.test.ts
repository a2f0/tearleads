import { expect, test } from "bun:test";
import { createDocument } from "@tearleads/loro";
import {
  addDocumentAttachments,
  ensureDocumentAttachmentStructure,
} from "../../../../data/documents/documentContent";
import type { LocalAttachmentRecord } from "../../../../workflows/documents";
import {
  listUnsettledAttachmentMarkers,
  withLocalAttachmentDetachState,
} from "./attachmentDetachState";

const DETACHED_AT = "2026-07-26T00:00:00.000Z";

async function createDocumentWithSlots(slotIds: ReadonlyArray<string>) {
  const doc = await createDocument("attachment-detach-state-test");
  ensureDocumentAttachmentStructure(doc);
  addDocumentAttachments(
    doc,
    slotIds.map((slotId) => ({
      contentSha256: "1".repeat(64),
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
    contentSha256: "0".repeat(64),
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

test("listUnsettledAttachmentMarkers reports only rows that disagree with the document", async () => {
  // Every slot records digest "1"; createLocalAttachment holds digest "0".
  const doc = await createDocumentWithSlots([
    "slot-live",
    "slot-readded",
    "slot-readded-other",
    "slot-served-other",
  ]);
  const sameCopy = (slotId: string, detachedAt: string | null = null) => ({
    ...createLocalAttachment(slotId, detachedAt),
    contentSha256: "1".repeat(64),
  });

  const unsettled = listUnsettledAttachmentMarkers(
    [
      sameCopy("slot-live"),
      // Removed here, then added back with the same bytes elsewhere.
      sameCopy("slot-readded", DETACHED_AT),
      // Removed here, then added back with other bytes.
      createLocalAttachment("slot-readded-other", DETACHED_AT),
      // A held served copy the content has not recorded yet stays.
      createLocalAttachment("slot-served-other"),
      // Dropped from the document while its row stayed live.
      sameCopy("slot-missing-marker"),
      // Still owes its detach.
      sameCopy("slot-removed", DETACHED_AT),
    ],
    doc,
  );

  expect(unsettled.map((attachment) => attachment.slotId)).toEqual([
    "slot-readded",
    "slot-readded-other",
    "slot-missing-marker",
  ]);
});

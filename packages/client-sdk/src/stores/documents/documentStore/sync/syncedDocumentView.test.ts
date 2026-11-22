import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import {
  addDocumentAttachments,
  ensureDocumentAttachmentStructure,
} from "../../../../data/documents/documentContent";
import type { DocumentStoreState } from "../state";
import { captureSyncedDocumentView } from "./syncedDocumentView";

async function documentRecordingSlot() {
  const doc = await createDocument("synced-view");
  ensureDocumentAttachmentStructure(doc);
  addDocumentAttachments(doc, [
    {
      byteLength: 3,
      contentSha256: "a".repeat(64),
      mimeType: "image/png",
      name: "avatar.png",
      slotId: "avatar",
    },
  ]);
  doc.commit();
  return doc;
}

function storeAt(
  pendingBaseVersion: string | null,
  pendingLocalWrites = 0,
): DocumentStoreState {
  return { pendingBaseVersion, pendingLocalWrites } as DocumentStoreState;
}

test("a document whose every op is enqueued or pulled is cited as it stands", async () => {
  const doc = await documentRecordingSlot();
  const versionVector = encodeVersionVector(doc);

  expect(captureSyncedDocumentView(storeAt(versionVector), doc)).toEqual({
    slotIds: new Set(["avatar"]),
    versionVector,
  });
});

test("a document holding an edit not yet enqueued is never cited", async () => {
  const doc = await documentRecordingSlot();
  const enqueued = encodeVersionVector(doc);

  // A write still queued on the store's write chain.
  expect(captureSyncedDocumentView(storeAt(enqueued, 1), doc)).toBeNull();
  // An edit applied to the live document but not yet enqueued, such as a
  // removal that may yet roll back.
  doc.getText("staged").insert(0, "edit");
  doc.commit();
  expect(captureSyncedDocumentView(storeAt(enqueued), doc)).toBeNull();
  expect(captureSyncedDocumentView(storeAt(null), doc)).toBeNull();
});

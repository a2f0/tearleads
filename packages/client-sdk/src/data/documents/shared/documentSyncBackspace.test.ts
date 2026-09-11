import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getUpdateVersionVectors,
  importSnapshot,
} from "@tearleads/loro";
import {
  addDocumentAttachments,
  getDocumentAttachments,
} from "../documentContent";
import {
  importDecryptedDocumentSyncUpdates,
  validateDocumentSyncUpdateImports,
} from "./documentSyncUpdateIsolation";
import type { DecryptedDocumentSyncUpdate } from "./types";

for (const backspacesPerUpdate of [1, 2, 3]) {
  test(`attached note validates ${backspacesPerUpdate} backspaces per update before and after reload`, async () => {
    const original = await createDocument("backspace-original-device");
    const restored = await createDocument("backspace-restored-device");
    const reloaded = await createDocument("backspace-reloaded-device");
    try {
      const initialText = "a".repeat(55);
      const attachment = {
        slotId: "attachment-slot",
        name: "note-attachment.png",
        byteLength: 42,
        mimeType: "image/png",
      };
      original.getText("text").update(initialText);
      addDocumentAttachments(original, [attachment]);
      importSnapshot(restored, exportFullHistorySnapshot(original));
      const updates: DecryptedDocumentSyncUpdate[] = [];
      for (let index = 0; index < 51; index += backspacesPerUpdate) {
        const base = encodeVersionVector(restored);
        const text = restored.getText("text");
        for (
          let offset = 0;
          offset < backspacesPerUpdate && index + offset < 51;
          offset += 1
        ) {
          text.delete(text.length - 1, 1);
          restored.commit();
        }
        const updateData = exportUpdatesSince(restored, base);
        updates.push({
          id: `backspace-${index}`,
          ...getUpdateVersionVectors(updateData),
          updateData,
        });
      }

      await validateDocumentSyncUpdateImports({
        currentDocument: original,
        decryptedUpdates: updates,
      });
      expect(original.getText("text").toString()).toBe(initialText);
      importDecryptedDocumentSyncUpdates(original, updates);
      expect(original.getText("text").toString()).toBe("aaaa");
      expect(getDocumentAttachments(original)).toEqual([attachment]);

      importSnapshot(reloaded, exportFullHistorySnapshot(original));
      await validateDocumentSyncUpdateImports({
        currentDocument: reloaded,
        decryptedUpdates: updates,
      });
      expect(reloaded.getText("text").toString()).toBe("aaaa");
      expect(getDocumentAttachments(reloaded)).toEqual([attachment]);
      // Rotation provenance compares a live, coalesced history with one rebuilt
      // from the server's individual update blobs, at the live frontier.
      const liveVersion = encodeVersionVector(restored);
      for (const rebuilt of [original, reloaded]) {
        expect(exportFullHistoryIdentity(rebuilt, liveVersion)).toBe(
          exportFullHistoryIdentity(restored),
        );
      }
    } finally {
      original.free();
      restored.free();
      reloaded.free();
    }
  });
}

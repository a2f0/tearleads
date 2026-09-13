import { expect, test } from "bun:test";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createDocumentStorePersistence } from "../../../../test/helpers/documentStoreFixtures";

for (const factory of [
  createDocumentsPersistence,
  createDocumentStorePersistence,
]) {
  for (const condition of [
    "current",
    "stale-version",
    "stale-copy",
    "stale-intent",
    "missing",
    "new",
    "foreign",
  ]) {
    test(`${factory.name} hydration guards ${condition}`, async () => {
      const persistence = factory();
      const execSql = async () => [];
      if (condition !== "missing" && condition !== "new") {
        await persistence.saveDocument(execSql, {
          id: condition === "foreign" ? "other-document" : "local-document",
          documentId: "remote-document",
          containerId: "container",
          accessEpoch: 1,
          snapshotEndVersion: "current-version",
          text: "",
        });
      }
      const held = {
        localId: "local-document",
        slotId: "slot",
        blobId: "held",
        byteLength: 4,
        contentSha256: "0".repeat(64),
        mimeType: null,
        detachedAt: null,
        storageKey: "held-copy",
      };
      await persistence.saveLocalAttachment(execSql, held);
      const replacement = { ...held, blobId: "new", storageKey: "new-copy" };
      const committed = await persistence.saveHydratedAttachment(execSql, {
        attachment: replacement,
        expectedStorageKey:
          condition === "stale-copy" ? "old-copy" : held.storageKey,
        expectedSnapshotEndVersion:
          condition === "new"
            ? null
            : condition === "stale-version"
              ? "old-version"
              : "current-version",
        stillCurrent: () => condition !== "stale-intent",
      });
      const shouldCommit = condition === "current" || condition === "new";
      expect(committed).toBe(shouldCommit);
      expect(
        await persistence.listLocalAttachments(execSql, held.localId),
      ).toEqual([shouldCommit ? replacement : held]);
    });
  }
}

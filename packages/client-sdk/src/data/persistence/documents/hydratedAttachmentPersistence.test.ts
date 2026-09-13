import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "./documentsPersistence";
import type { LocalAttachmentRecord } from "./types";

function attachment(storageKey: string): LocalAttachmentRecord {
  return {
    blobId: storageKey,
    byteLength: 4,
    contentSha256: "0".repeat(64),
    detachedAt: null,
    localId: "local-document",
    mimeType: "text/plain",
    slotId: "preview",
    storageKey,
  };
}

test("reloading a slot cannot let an older document overwrite newer intent", async () => {
  const { execSql, close } = await createTestExecSql(
    "hydration-intent-frontier",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      containerId: null,
      documentId: "remote-document",
      id: "local-document",
      snapshotEndVersion: "newer-frontier",
      text: "",
    });
    await sqlDocumentsPersistence.saveLocalAttachment(
      execSql,
      attachment("newer-copy"),
    );
    for (const expectedSnapshotEndVersion of [
      "older-frontier",
      "newer-frontier",
    ]) {
      expect(
        await sqlDocumentsPersistence.saveHydratedAttachment(execSql, {
          attachment: attachment("downloaded-copy"),
          expectedStorageKey: "newer-copy",
          expectedSnapshotEndVersion,
          stillCurrent: () => true,
        }),
      ).toBe(expectedSnapshotEndVersion === "newer-frontier");
      const rows = await sqlDocumentsPersistence.listLocalAttachments(
        execSql,
        "local-document",
      );
      expect(rows[0]?.storageKey).toBe(
        expectedSnapshotEndVersion === "newer-frontier"
          ? "downloaded-copy"
          : "newer-copy",
      );
    }
  } finally {
    close();
  }
});

for (const observed of [null, "older-copy"]) {
  test(`a delayed hydration cannot replace a competing durable copy observed as ${observed}`, async () => {
    const { execSql, close } = await createTestExecSql(
      "hydrated-attachment-cas",
    );
    try {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      if (observed)
        await sqlDocumentsPersistence.saveLocalAttachment(
          execSql,
          attachment(observed),
        );
      // A second facade installs its result while the first facade downloads.
      await sqlDocumentsPersistence.saveLocalAttachment(
        execSql,
        attachment("newer-copy"),
      );
      expect(
        await sqlDocumentsPersistence.saveHydratedAttachment(execSql, {
          attachment: attachment("replayed-copy"),
          expectedStorageKey: observed,
          expectedSnapshotEndVersion: null,
          stillCurrent: () => true,
        }),
      ).toBe(false);
      expect(
        await sqlDocumentsPersistence.listLocalAttachments(
          execSql,
          "local-document",
        ),
      ).toEqual([attachment("newer-copy")]);
    } finally {
      close();
    }
  });
}

test("a document changing before the SQL commit rolls the hydrated replacement back", async () => {
  const { execSql, close } = await createTestExecSql(
    "hydrated-attachment-guard",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveLocalAttachment(
      execSql,
      attachment("held-copy"),
    );
    expect(
      await sqlDocumentsPersistence.saveHydratedAttachment(execSql, {
        attachment: attachment("replayed-copy"),
        expectedStorageKey: "held-copy",
        expectedSnapshotEndVersion: null,
        stillCurrent: () => false,
      }),
    ).toBe(false);
    expect(
      await sqlDocumentsPersistence.listLocalAttachments(
        execSql,
        "local-document",
      ),
    ).toEqual([attachment("held-copy")]);
    expect(
      await sqlDocumentsPersistence.saveHydratedAttachment(execSql, {
        attachment: attachment("current-copy"),
        expectedStorageKey: "held-copy",
        expectedSnapshotEndVersion: null,
        stillCurrent: () => true,
      }),
    ).toBe(true);
    expect(
      await sqlDocumentsPersistence.listLocalAttachments(
        execSql,
        "local-document",
      ),
    ).toEqual([attachment("current-copy")]);
  } finally {
    close();
  }
});

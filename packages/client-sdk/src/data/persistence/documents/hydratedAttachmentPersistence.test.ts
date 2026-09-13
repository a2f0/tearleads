import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "./documentsPersistence";
import type { LocalAttachmentRecord } from "./types";

function attachment(storageKey: string): LocalAttachmentRecord {
  return {
    blobId: storageKey,
    byteLength: 4,
    detachedAt: null,
    localId: "local-document",
    mimeType: "text/plain",
    slotId: "preview",
    storageKey,
  };
}

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

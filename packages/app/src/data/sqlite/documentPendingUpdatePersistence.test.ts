import { expect, test } from "bun:test";
import { createTestExecSql } from "../../../test/helpers/createTestExecSql";
import {
  deleteDocumentPendingUpdate,
  deleteDocumentPendingUpdates,
  enqueueDocumentPendingUpdate,
  ensureDocumentTables,
  listDocumentPendingUpdates,
} from "./documentPersistence";

const documentScope = {
  appKind: "documents",
  localId: "local-document-1",
};

test("document pending updates persist queue fields and delete by id", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pending-update-persistence-test",
  );

  try {
    await ensureDocumentTables(execSql);

    await enqueueDocumentPendingUpdate(execSql, documentScope, {
      updateData: "update-1",
      partialStartVersionVector: "start-vector-1",
      partialEndVersionVector: "end-vector-1",
    });

    const pendingUpdates = await listDocumentPendingUpdates(
      execSql,
      documentScope,
    );
    const pendingUpdate = pendingUpdates[0];

    expect(pendingUpdates).toHaveLength(1);
    expect(typeof pendingUpdate?.id).toBe("string");
    expect(pendingUpdate?.id.length).toBeGreaterThan(0);
    expect(pendingUpdate).toMatchObject({
      updateData: "update-1",
      partialStartVersionVector: "start-vector-1",
      partialEndVersionVector: "end-vector-1",
      sourceVersionVector: null,
    });

    await deleteDocumentPendingUpdate(execSql, pendingUpdate?.id ?? "");

    await expect(
      listDocumentPendingUpdates(execSql, documentScope),
    ).resolves.toEqual([]);
  } finally {
    close();
  }
});

test("document pending update cleanup is scoped by app kind and local id", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pending-update-cleanup-test",
  );

  const otherAppScope = {
    appKind: "other-app",
    localId: documentScope.localId,
  };
  const otherLocalScope = {
    appKind: documentScope.appKind,
    localId: "local-document-2",
  };

  try {
    await ensureDocumentTables(execSql);

    for (const [scope, updateData] of [
      [documentScope, "scoped-update"],
      [otherAppScope, "other-app-update"],
      [otherLocalScope, "other-local-update"],
    ] as const) {
      await enqueueDocumentPendingUpdate(execSql, scope, {
        updateData,
        partialStartVersionVector: `${updateData}-start`,
        partialEndVersionVector: `${updateData}-end`,
        sourceVersionVector: `${updateData}-source`,
      });
    }

    await deleteDocumentPendingUpdates(execSql, documentScope);

    await expect(
      listDocumentPendingUpdates(execSql, documentScope),
    ).resolves.toEqual([]);
    await expect(
      listDocumentPendingUpdates(execSql, otherAppScope),
    ).resolves.toMatchObject([
      {
        updateData: "other-app-update",
        sourceVersionVector: "other-app-update-source",
      },
    ]);
    await expect(
      listDocumentPendingUpdates(execSql, otherLocalScope),
    ).resolves.toMatchObject([
      {
        updateData: "other-local-update",
        sourceVersionVector: "other-local-update-source",
      },
    ]);
  } finally {
    close();
  }
});

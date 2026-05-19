import { expect, test } from "bun:test";
import type { ExecSql } from "@tearleads/client-sdk/data/sqlite/sqlSchema";
import {
  type DocumentsPersistence,
  loadPersistedDocumentStoreStateFromRuntime,
  type PendingAttachmentRecord,
  savePendingDocumentAttachmentFromRuntime,
} from "@tearleads/client-sdk/workflows/documents/index";

function createNoopExecSql(): ExecSql {
  return (async () => []) as ExecSql;
}

test("loadPersistedDocumentStoreStateFromRuntime uses the runtime executor", async () => {
  const execSql = createNoopExecSql();
  const calls: string[] = [];
  const persistence = {
    ensureSchema: async (nextExecSql: ExecSql) => {
      expect(nextExecSql).toBe(execSql);
      calls.push("ensureSchema");
    },
    loadDocument: async (nextExecSql: ExecSql, localId: string) => {
      expect(nextExecSql).toBe(execSql);
      expect(localId).toBe("local-document");
      calls.push("loadDocument");
      return null;
    },
    listPendingAttachments: async (nextExecSql: ExecSql, localId: string) => {
      expect(nextExecSql).toBe(execSql);
      expect(localId).toBe("local-document");
      calls.push("listPendingAttachments");
      return [];
    },
    listLocalAttachments: async (nextExecSql: ExecSql, localId: string) => {
      expect(nextExecSql).toBe(execSql);
      expect(localId).toBe("local-document");
      calls.push("listLocalAttachments");
      return [];
    },
  } as unknown as DocumentsPersistence;

  const loaded = await loadPersistedDocumentStoreStateFromRuntime({
    localId: "local-document",
    persistence,
    runtime: { execSql },
  });

  expect(calls).toEqual([
    "ensureSchema",
    "loadDocument",
    "listPendingAttachments",
    "listLocalAttachments",
  ]);
  expect(loaded).toEqual({
    document: null,
    localAttachments: [],
    pendingAttachments: [],
  });
});

test("savePendingDocumentAttachmentFromRuntime uses the runtime executor", async () => {
  const execSql = createNoopExecSql();
  const attachment: PendingAttachmentRecord = {
    byteLength: 12,
    localId: "local-document",
    mimeType: "text/plain",
    name: "attachment.txt",
    slotId: "slot",
    storageKey: "storage",
  };
  const savedAttachments: PendingAttachmentRecord[] = [];
  const persistence = {
    savePendingAttachment: async (
      nextExecSql: ExecSql,
      nextAttachment: PendingAttachmentRecord,
    ) => {
      expect(nextExecSql).toBe(execSql);
      savedAttachments.push(nextAttachment);
    },
  } as unknown as DocumentsPersistence;

  await savePendingDocumentAttachmentFromRuntime({
    attachment,
    persistence,
    runtime: { execSql },
  });

  expect(savedAttachments).toEqual([attachment]);
});

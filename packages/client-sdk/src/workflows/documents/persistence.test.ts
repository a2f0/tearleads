import { expect, test } from "bun:test";
import {
  type DocumentRecord,
  type DocumentsPersistence,
  loadPersistedDocumentStoreStateFromRuntime,
  type PendingAttachmentRecord,
  savePendingDocumentAttachmentFromRuntime,
} from "@tearleads/client-sdk/workflows/documents";
import { createDocument } from "@tearleads/loro";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createDocumentProjectorRegistry } from "../../documents";
import { persistDocumentStateFromRuntime } from "./persistence";

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

test("persistDocumentStateFromRuntime ensures client projection tables once per executor and registry", async () => {
  const statements: string[] = [];
  const execSql: ExecSql = (async (sql: string) => {
    statements.push(sql);
    return [];
  }) as ExecSql;
  let currentRecord: DocumentRecord | null = null;
  const persistence = {
    saveDocument: async (_execSql: ExecSql, record: DocumentRecord) => {
      currentRecord = record;
      return "2026-05-24T00:00:00.000Z";
    },
  } as unknown as DocumentsPersistence;
  const documentProjectors = createDocumentProjectorRegistry([
    {
      kind: "note",
      clientProjection: {
        tables: [
          {
            name: "note_projection",
            createSql:
              'CREATE TABLE IF NOT EXISTS "note_projection" ("local_id" TEXT PRIMARY KEY)',
            indexes: [
              'CREATE INDEX IF NOT EXISTS "note_projection_local_idx" ON "note_projection" ("local_id")',
            ],
          },
        ],
        save: async ({ execSql: projectionExecSql }) => {
          await projectionExecSql(
            'INSERT INTO "note_projection" DEFAULT VALUES',
          );
        },
      },
    },
  ]);
  const currentDoc = await createDocument("projection-schema-cache");
  const runtime = { documentProjectors, execSql };

  await persistDocumentStateFromRuntime({
    currentDoc,
    currentRecord,
    localId: "local-document",
    persistence,
    runtime,
  });
  await persistDocumentStateFromRuntime({
    currentDoc,
    currentRecord,
    localId: "local-document",
    persistence,
    runtime,
  });

  expect(
    statements.filter((statement) =>
      statement.includes('CREATE TABLE IF NOT EXISTS "note_projection"'),
    ),
  ).toHaveLength(1);
  expect(
    statements.filter((statement) =>
      statement.includes(
        'CREATE INDEX IF NOT EXISTS "note_projection_local_idx"',
      ),
    ),
  ).toHaveLength(1);
});

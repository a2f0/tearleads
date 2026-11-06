import { describe, expect, test } from "bun:test";
import { emptyVersionVector } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { quietLogger } from "../test/helpers/clientTestSupport";
import { Tearleads } from ".";
import type {
  ExecSql,
  SqlArrayRow,
  SqlBind,
  SqlRow,
  SqlRowMode,
} from "./sqlite";
import { defaultDocumentsPersistence } from "./workflows/documents";

function createObservedExecSql(
  execSql: ExecSql,
  observe: (sql: string) => void,
): ExecSql {
  async function observedExecSql(
    sql: string,
    bind?: SqlBind,
    options?: { rowMode?: SqlRowMode },
  ): Promise<Array<SqlRow | SqlArrayRow>> {
    observe(sql);
    return execSql(sql, bind, options);
  }

  return observedExecSql as ExecSql;
}

describe("Tearleads", () => {
  test("lists documents through the documents service", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-documents-list-test",
    );
    try {
      await defaultDocumentsPersistence.ensureSchema(execSql);
      await defaultDocumentsPersistence.saveDocument(
        execSql,
        {
          accessEpoch: 1,
          accessStateHash: null,
          containerId: "container-1",
          contentKeyBundle: null,
          documentId: null,
          documentKekTargets: null,
          documentKind: "note",
          documentManifestBundle: null,
          id: "note-1",
          lastCommitLsn: null,
          snapshotEndVersion: "",
          text: "Note text",
          title: "Note title",
        },
        { updatedAt: "2026-05-24T12:00:00.000Z" },
      );
      await defaultDocumentsPersistence.saveDocument(
        execSql,
        {
          accessEpoch: 1,
          accessStateHash: null,
          containerId: "container-1",
          contentKeyBundle: null,
          documentId: null,
          documentKekTargets: null,
          documentKind: "contact",
          documentManifestBundle: null,
          id: "contact-1",
          lastCommitLsn: null,
          snapshotEndVersion: "",
          text: "",
          title: "Contact title",
        },
        { updatedAt: "2026-05-24T11:00:00.000Z" },
      );
      const sdk = new Tearleads({
        database: { execSql, id: "client-db" },
        logger: quietLogger,
      });

      expect(await sdk.documents.list({ documentKind: "note" })).toEqual({
        rows: [
          {
            accessStateHash: null,
            containerId: "container-1",
            documentId: null,
            documentKind: "note",
            effectiveAccessLevel: "read",
            id: "note-1",
            title: "Note title",
            updatedAt: "2026-05-24T12:00:00.000Z",
          },
        ],
        totalCount: 1,
      });
      await expect(sdk.documents.delete("note-1")).resolves.toBe(true);
      expect(await sdk.documents.list({ documentKind: "note" })).toEqual({
        rows: [],
        totalCount: 0,
      });
    } finally {
      close();
    }
  });

  test("lists documents with pagination and sorting", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-documents-list-window-test",
    );
    try {
      await defaultDocumentsPersistence.ensureSchema(execSql);
      async function saveNote(
        id: string,
        title: string,
        updatedAt: string,
      ): Promise<void> {
        await defaultDocumentsPersistence.saveDocument(
          execSql,
          {
            accessEpoch: 1,
            accessStateHash: null,
            containerId: "container-1",
            contentKeyBundle: null,
            documentId: null,
            documentKekTargets: null,
            documentKind: "note",
            documentManifestBundle: null,
            id,
            lastCommitLsn: null,
            snapshotEndVersion: "",
            text: title,
            title,
          },
          { updatedAt },
        );
      }

      await saveNote("note-z", "Zebra", "2026-05-24T12:00:00.000Z");
      await saveNote("note-a", "Alpha", "2026-05-24T11:00:00.000Z");
      await saveNote("note-m", "Middle", "2026-05-24T10:00:00.000Z");
      const sdk = new Tearleads({
        database: { execSql, id: "client-db" },
        logger: quietLogger,
      });

      expect(
        await sdk.documents.list({
          documentKind: "note",
          limit: 2,
          offset: 1,
          sort: { direction: "asc", key: "title" },
        }),
      ).toEqual({
        rows: [
          {
            accessStateHash: null,
            containerId: "container-1",
            documentId: null,
            documentKind: "note",
            effectiveAccessLevel: "read",
            id: "note-m",
            title: "Middle",
            updatedAt: "2026-05-24T10:00:00.000Z",
          },
          {
            accessStateHash: null,
            containerId: "container-1",
            documentId: null,
            documentKind: "note",
            effectiveAccessLevel: "read",
            id: "note-z",
            title: "Zebra",
            updatedAt: "2026-05-24T12:00:00.000Z",
          },
        ],
        totalCount: 3,
      });
    } finally {
      close();
    }
  });

  test("caches documents service schema initialization per SQL executor", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-documents-list-schema-cache-test",
    );
    try {
      let createStatementCount = 0;
      const observedExecSql = createObservedExecSql(execSql, (sql) => {
        if (sql.startsWith("CREATE TABLE IF NOT EXISTS")) {
          createStatementCount += 1;
        }
      });
      const sdk = new Tearleads({
        database: {
          execSql: observedExecSql,
          id: "client-db",
        },
        logger: quietLogger,
      });
      expect(await sdk.documents.list()).toEqual({
        rows: [],
        totalCount: 0,
      });
      const firstCreateCount = createStatementCount;
      expect(firstCreateCount).toBeGreaterThan(0);
      expect(await sdk.documents.list()).toEqual({
        rows: [],
        totalCount: 0,
      });
      expect(createStatementCount).toBe(firstCreateCount);
    } finally {
      close();
    }
  });

  test("creates the container contents document queries from the SDK runtime", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-container-contents-queries-test",
    );
    try {
      await defaultDocumentsPersistence.ensureSchema(execSql);
      await defaultDocumentsPersistence.saveDocument(
        execSql,
        {
          accessEpoch: 1,
          accessStateHash: "access-state-hash",
          containerId: "container-1",
          contentKeyBundle: null,
          documentId: "document-1",
          documentKekTargets: null,
          documentKind: "note",
          documentManifestBundle: null,
          id: "note-1",
          lastCommitLsn: null,
          snapshotEndVersion: emptyVersionVector(),
          text: "Note text",
          title: "Note title",
        },
        { updatedAt: "2026-05-24T12:00:00.000Z" },
      );
      const sdk = new Tearleads({
        database: { execSql, id: "client-db" },
        logger: quietLogger,
      });
      const readModel = sdk.containerContents.documentQueries();

      expect(await readModel.loadDocumentSummary("note-1")).toEqual({
        accessStateHash: "access-state-hash",
        containerId: "container-1",
        documentId: "document-1",
        documentKind: "note",
        effectiveAccessLevel: "read",
        id: "note-1",
        title: "Note title",
        updatedAt: "2026-05-24T12:00:00.000Z",
      });
    } finally {
      close();
    }
  });
});

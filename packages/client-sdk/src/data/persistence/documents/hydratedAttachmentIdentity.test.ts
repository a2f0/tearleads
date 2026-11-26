import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { and, eq } from "drizzle-orm";
import { DOCUMENTS_APP_KIND } from "../../documents/documentConstants";
import { documents } from "../../sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { createExecSql, type ExecSql } from "../../sqlite/sqlSchema";
import {
  CONTAINER_METADATA_APP_KIND,
  sqlContainerContentsPersistence,
} from "../container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "./documentsPersistence";
import type { LocalAttachmentRecord } from "./types";

const LOCAL_ID = "shared-local-id";
const attachment: LocalAttachmentRecord = {
  blobId: "downloaded-blob",
  byteLength: 4,
  contentSha256: "0".repeat(64),
  detachedAt: null,
  localId: LOCAL_ID,
  mimeType: "text/plain",
  slotId: "preview",
  storageKey: "downloaded-copy",
};

async function saveMetadata(execSql: ExecSql) {
  await sqlContainerContentsPersistence.ensureSchema(execSql);
  await sqlContainerContentsPersistence.saveContainer(
    execSql,
    {
      effectiveAccessLevel: "write",
      icon: null,
      id: LOCAL_ID,
      metadataDocumentId: "metadata-document",
      name: "Container",
      organizationId: "organization",
      parentId: null,
    },
    {
      accessEpoch: 1,
      documentId: "metadata-document",
      id: LOCAL_ID,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  );
}

async function saveDocument(execSql: ExecSql) {
  await sqlDocumentsPersistence.saveDocument(execSql, {
    accessEpoch: 1,
    containerId: null,
    documentId: "remote-document",
    id: LOCAL_ID,
    snapshotEndVersion: "document-frontier",
    text: "",
  });
}

for (const metadataFirst of [true, false]) {
  test(`hydration's guard reads the document, not metadata sharing its local id: metadata first ${metadataFirst}`, async () => {
    const { execSql, close } = await createTestExecSql(
      "hydration-kind-identity",
    );
    try {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      if (metadataFirst) await saveMetadata(execSql);
      await saveDocument(execSql);
      if (!metadataFirst) await saveMetadata(execSql);
      const { db } = getClientSQLitePersistenceRuntime(execSql);
      expect(
        await db
          .select({ appKind: documents.appKind })
          .from(documents)
          .where(eq(documents.localId, LOCAL_ID))
          .orderBy(documents.appKind),
      ).toEqual([
        { appKind: CONTAINER_METADATA_APP_KIND },
        { appKind: DOCUMENTS_APP_KIND },
      ]);
      // The ordinary loader selects the documents namespace even when the
      // metadata writer created the same local id first. No corrupt/raw rows.
      const loaded = await sqlDocumentsPersistence.loadDocument(
        execSql,
        LOCAL_ID,
      );
      expect(loaded?.snapshotEndVersion).toBe("document-frontier");
      expect(
        await db
          .select({ snapshot: documents.snapshotEndVersion })
          .from(documents)
          .where(
            and(
              eq(documents.appKind, DOCUMENTS_APP_KIND),
              eq(documents.localId, LOCAL_ID),
            ),
          ),
      ).toEqual([{ snapshot: "document-frontier" }]);
      // Attachment rows carry a document's local id, so the guard compares
      // the document's frontier whichever kind was written first.
      const committed = await sqlDocumentsPersistence.saveHydratedAttachment(
        execSql,
        {
          attachment,
          expectedStorageKey: null,
          expectedSnapshotEndVersion: loaded?.snapshotEndVersion ?? null,
          stillCurrent: () => true,
        },
      );
      expect(committed).toBe(true);
      expect(
        await sqlDocumentsPersistence.listLocalAttachments(execSql, LOCAL_ID),
      ).toEqual([attachment]);
    } finally {
      close();
    }
  });
}

for (const expectedSnapshotEndVersion of [null, "", "document-frontier"]) {
  test(`missing document hydration compares the snapshot to ${JSON.stringify(expectedSnapshotEndVersion)}`, async () => {
    const { execSql, close } = await createTestExecSql(
      "hydration-missing-document",
    );
    try {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      expect(
        await sqlDocumentsPersistence.loadDocument(execSql, LOCAL_ID),
      ).toBeNull();
      const committed = await sqlDocumentsPersistence.saveHydratedAttachment(
        execSql,
        {
          attachment,
          expectedStorageKey: null,
          expectedSnapshotEndVersion,
          stillCurrent: () => true,
        },
      );
      expect(committed).toBe(expectedSnapshotEndVersion === null);
      expect(
        await sqlDocumentsPersistence.listLocalAttachments(execSql, LOCAL_ID),
      ).toEqual(committed ? [attachment] : []);
    } finally {
      close();
    }
  });
}

for (const expectedSnapshotEndVersion of [null, "", "document-frontier"]) {
  test(`hydration with only metadata at the local id finds no document and compares to ${JSON.stringify(expectedSnapshotEndVersion)}`, async () => {
    const { execSql, close } = await createTestExecSql(
      "hydration-metadata-only",
    );
    try {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      await saveMetadata(execSql);
      expect(
        await sqlDocumentsPersistence.loadDocument(execSql, LOCAL_ID),
      ).toBeNull();
      const committed = await sqlDocumentsPersistence.saveHydratedAttachment(
        execSql,
        {
          attachment,
          expectedStorageKey: null,
          expectedSnapshotEndVersion,
          stillCurrent: () => true,
        },
      );
      expect(committed).toBe(expectedSnapshotEndVersion === null);
      expect(
        await sqlDocumentsPersistence.listLocalAttachments(execSql, LOCAL_ID),
      ).toEqual(committed ? [attachment] : []);
    } finally {
      close();
    }
  });
}

// The guard runs inside an immediate transaction, once per hydrated
// attachment. A lookup by local id alone reads every document row.
test("hydration's guard reads its document by primary key", async () => {
  const f = await createTestExecSql("hydration-guard-plan");
  const statements: Array<{ bind: Parameters<ExecSql>[1]; sql: string }> = [];
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      if (/^select\b/i.test(sql) && sql.includes('from "documents"'))
        statements.push({ bind, sql });
      return {
        rows: await f.execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  });
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveDocument(execSql);
    await saveMetadata(execSql);
    statements.length = 0;
    expect(
      await sqlDocumentsPersistence.saveHydratedAttachment(execSql, {
        attachment,
        expectedStorageKey: null,
        expectedSnapshotEndVersion: "document-frontier",
        stillCurrent: () => true,
      }),
    ).toBe(true);
    expect(statements).toHaveLength(1);
    const [statement] = statements;
    if (!statement) throw new Error("the guard did not read its document");
    const plan = await f.execSql(
      `EXPLAIN QUERY PLAN ${statement.sql}`,
      statement.bind,
    );
    expect(plan.map((row) => String(Reflect.get(row, "detail")))).toEqual([
      "SEARCH documents USING INDEX sqlite_autoindex_documents_1 (app_kind=? AND local_id=?)",
    ]);
  } finally {
    f.close();
  }
});

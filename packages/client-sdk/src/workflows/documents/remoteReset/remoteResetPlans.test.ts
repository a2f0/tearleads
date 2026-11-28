import { expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { DOCUMENTS_APP_KIND } from "../../../data/persistence/documents/documentsPersistence";
import { clientSqlTables } from "../../../data/sqlite/schema";
import {
  documentHistoryCheckpoints,
  documents,
} from "../../../data/sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../../data/sqlite/sqlTableSchema";
import { buildResetPlans } from "./remoteResetPlans";

test("buildResetPlans splits a large document history into ordered bounded segments", async () => {
  const sqlite = await createTestExecSql("remote-reset-segments");
  try {
    await ensureSqlTables(sqlite.execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(sqlite.execSql);
    const localId = "large-reset-doc";
    const doc = await createDocument("reset-peer");
    const text = doc.getText("text");
    for (let i = 0; i < 12; i += 1) {
      text.insert(text.length, `chunk-${i}:${"x".repeat(40)}\n`);
      doc.commit();
    }
    const expectedText = text.toString();
    const version = encodeVersionVector(doc);
    const snapshot = bytesToBase64(doc.export({ mode: "snapshot" }));
    doc.free();

    await db.insert(documents).values({
      appKind: DOCUMENTS_APP_KIND,
      documentId: "remote-large-reset-doc",
      localId,
      snapshotEndVersion: version,
      updatedAt: "2026-11-28T00:00:00.000Z",
    });
    await db.insert(documentHistoryCheckpoints).values({
      appKind: DOCUMENTS_APP_KIND,
      endVersionVector: version,
      localId,
      revision: "rev-1",
      snapshot,
      updatedAt: "2026-11-28T00:00:00.000Z",
    });

    const plans = await buildResetPlans(
      db,
      [{ appKind: DOCUMENTS_APP_KIND, localId }],
      { segmentSizes: { maxBytes: 400, targetBytes: 250 } },
    );

    expect(plans.documentUpdates.length).toBeGreaterThan(1);
    const reader = await createDocument("reset-reader");
    for (const segment of plans.documentUpdates) {
      const bytes = base64ToBytes(segment.updateData);
      expect(bytes.byteLength).toBeLessThanOrEqual(400);
      const status = reader.import(bytes);
      expect(status.pending == null || status.pending.size === 0).toBe(true);
    }
    expect(reader.getText("text").toString()).toBe(expectedText);
    reader.free();
  } finally {
    await sqlite.close();
  }
});

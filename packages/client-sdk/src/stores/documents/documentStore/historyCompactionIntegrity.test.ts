import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  importSnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { DOCUMENT_HISTORY_COMPACTION_MAX_ROWS } from "../../../data/sqlite/documentHistoryPersistence";
import { openHistoryTestStore } from "./historyDurability.testFixtures";
import { persistDocument } from "./persistence";

test("compaction preserves a racing same-frontier fork and malformed tail", async () => {
  const { close, execSql } = await createTestExecSql(
    "history-same-frontier-compaction-race",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const state = await openHistoryTestStore(
      execSql,
      "same-frontier-compaction-doc",
      sqlDocumentsPersistence,
    );
    const genuine = await createDocument("same-frontier-compaction-writer");
    genuine.getText("text").update("verified base");
    genuine.commit();
    const baseVersion = encodeVersionVector(genuine);
    const baseSnapshot = exportFullHistorySnapshot(genuine);
    const forged = await createDocument("same-frontier-compaction-writer");
    importSnapshot(forged, baseSnapshot);

    genuine.getText("text").update(" genuine suffix");
    genuine.commit();
    forged.getText("text").update(" forged! suffix");
    forged.commit();
    expect(encodeVersionVector(forged)).toBe(encodeVersionVector(genuine));

    const genuineUpdate = bytesToBase64(
      exportUpdatesSince(genuine, baseVersion),
    );
    const forgedUpdate = bytesToBase64(exportUpdatesSince(forged, baseVersion));
    const malformedUpdate = "malformed-tail-evidence";
    await sqlDocumentsPersistence.appendHistoryUpdates(execSql, {
      localId: state.localId,
      origin: "remote",
      updates: [
        forgedUpdate,
        malformedUpdate,
        ...Array.from(
          { length: DOCUMENT_HISTORY_COMPACTION_MAX_ROWS },
          () => genuineUpdate,
        ),
      ],
    });
    state.doc = genuine;
    await persistDocument(state, genuine);

    const remaining = await sqlDocumentsPersistence.listHistoryTailEntries(
      execSql,
      state.localId,
    );
    expect(remaining.map(({ updateData }) => updateData)).toEqual([
      forgedUpdate,
      malformedUpdate,
    ]);
    forged.free();
  } finally {
    close();
  }
});

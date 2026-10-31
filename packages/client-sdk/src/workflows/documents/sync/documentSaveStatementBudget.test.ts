import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getTextValue,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { countingExecSql } from "../../../../test/helpers/statementCounting";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { persistDocumentState } from "../persistence";

const continuation = (cursor: string) => ({
  commitLsn: "0/2",
  commitLsnMode: "tracked" as const,
  cursor,
});

async function savedDocumentFixture(name: string) {
  const sqlite = await createTestExecSql(name);
  const counted = countingExecSql(sqlite.execSql);
  await sqlDocumentsPersistence.ensureSchema(counted.execSql);
  const doc = await createDocument(name);
  doc.getText("text").insert(0, "base");
  doc.commit();
  const baseVersion = encodeVersionVector(doc);
  await sqlDocumentsPersistence.saveDocument(counted.execSql, {
    accessEpoch: 1,
    containerId: "container-1",
    documentId: "remote-1",
    effectiveAccessLevel: "write",
    id: "local-1",
    pullContinuation: continuation("page-1"),
    snapshotEndVersion: baseVersion,
    text: getTextValue(doc),
  });
  await sqlDocumentsPersistence.replaceHistoryCheckpoint(counted.execSql, {
    coveredTailIds: [],
    endVersionVector: baseVersion,
    force: true,
    localId: "local-1",
    snapshot: bytesToBase64(exportFullHistorySnapshot(doc)),
  });
  const load = async () => {
    const record = await sqlDocumentsPersistence.loadDocument(
      counted.execSql,
      "local-1",
    );
    if (!record) throw new Error("Missing stored document");
    return record;
  };
  /** Statements for one save plus the compaction check that follows it. */
  const measure = async (
    save: () => Promise<unknown>,
  ): Promise<{ check: number; save: number }> => {
    counted.counter.statements = 0;
    const saved = await save();
    expect(saved).not.toBeNull();
    const savedStatements = counted.counter.statements;
    counted.counter.statements = 0;
    await sqlDocumentsPersistence.readHistoryTailSize(
      counted.execSql,
      "local-1",
    );
    return { check: counted.counter.statements, save: savedStatements };
  };
  return { ...sqlite, counted, doc, load, measure };
}

test("a local edit saves in a fixed number of statements", async () => {
  const f = await savedDocumentFixture("document-save-budget-local");
  try {
    const edit = async (text: string) => {
      const record = await f.load();
      const before = encodeVersionVector(f.doc);
      f.doc.getText("text").insert(0, text);
      f.doc.commit();
      const update = bytesToBase64(exportUpdatesSince(f.doc, before));
      return f.measure(() =>
        persistDocumentState({
          currentDoc: f.doc,
          currentRecord: record,
          documentProjectors: defaultDocumentProjectorRegistry,
          execSql: f.counted.execSql,
          historyUpdateOrigin: "local",
          historyUpdates: [update],
          localId: "local-1",
          patch: { snapshotEndVersion: encodeVersionVector(f.doc) },
          pendingUpdate: {
            partialEndVersionVector: encodeVersionVector(f.doc),
            partialStartVersionVector: before,
            sourceVersionVector: null,
            updateData: update,
          },
          persistence: sqlDocumentsPersistence,
        }),
      );
    };
    await edit("a");
    // Preparation read and container read, BEGIN IMMEDIATE, the joined
    // document load, history and pending-update inserts, the fenced upsert,
    // projection and text upserts, COMMIT; one compaction check (was 16 + 2).
    expect(await edit("b")).toEqual({ check: 1, save: 10 });
  } finally {
    f.close();
  }
});

test("a pulled page saves in the same statements at 1 and 64 updates", async () => {
  const f = await savedDocumentFixture("document-save-budget-pull");
  try {
    const remote = await createDocument("document-save-budget-remote");
    let page = 1;
    const pull = async (updateCount: number) => {
      const record = await f.load();
      const updates: string[] = [];
      for (let index = 0; index < updateCount; index += 1) {
        const before = encodeVersionVector(remote);
        remote.getText("text").insert(0, `${index}`);
        remote.commit();
        updates.push(bytesToBase64(exportUpdatesSince(remote, before)));
      }
      const consumed = continuation(`page-${page}`);
      page += 1;
      return f.measure(() =>
        persistDocumentState({
          clearSyncFailure: true,
          currentDoc: f.doc,
          currentRecord: record,
          documentProjectors: defaultDocumentProjectorRegistry,
          execSql: f.counted.execSql,
          expectedSyncState: { pullContinuation: consumed, record },
          historyUpdateOrigin: "remote",
          historyUpdates: updates,
          localId: "local-1",
          patch: { pullContinuation: continuation(`page-${page}`) },
          persistence: sqlDocumentsPersistence,
        }),
      );
    };
    await pull(1);
    // As a local edit, with the sync-failure clear folded into the fenced
    // upsert and no pending update (was 16 + 2).
    expect(await pull(1)).toEqual({ check: 1, save: 9 });
    expect(await pull(64)).toEqual({ check: 1, save: 9 });
  } finally {
    f.close();
  }
});

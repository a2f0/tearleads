import { expect, test } from "bun:test";
import { encodeVersionVector } from "@tearleads/loro";
import { createFileBackedSql } from "../../../../../test/helpers/fileBackedSql";
import { countingExecSql } from "../../../../../test/helpers/statementCounting";
import { createCoverageFixture } from "../../../../../test/helpers/syncOutgoingCoverage";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { setDocumentText } from "../mutations";
import { captureDocumentStoreSyncGeneration } from "../sync/syncGeneration";
import { prepareDocumentOutgoingCoverage } from "../sync/syncOutgoingCoverage";

test("an atomic text edit needs no outgoing-coverage rewrite", async () => {
  const db = await createFileBackedSql();
  const f = await createCoverageFixture("atomic-edit-coverage", true, db);
  const counted = countingExecSql(f.execSql);
  f.state.runtime = {
    ...f.state.runtime,
    infra: { ...f.state.runtime.infra, execSql: counted.execSql },
  };
  try {
    if (!f.state.record) throw new Error("Missing seeded record");
    await sqlDocumentsPersistence.saveDocument(counted.execSql, {
      ...f.state.record,
      effectiveAccessLevel: "write",
    });
    f.state.record = await sqlDocumentsPersistence.loadDocument(
      counted.execSql,
      f.localId,
    );
    await setDocumentText(f.state, () => {}, "warm edit");
    db.statements.length = 0;
    const editStatements = await counted.count(() =>
      setDocumentText(f.state, () => {}, "measured edit"),
    );
    const editWorkerMessages = db.statements.length;
    const pendingUpdates = await sqlDocumentsPersistence.listPendingUpdates(
      counted.execSql,
      f.localId,
    );
    const editAndQueueReadMessages = db.statements.length;
    db.statements.length = 0;
    const generation = captureDocumentStoreSyncGeneration(f.state, f.document);
    if (!generation) throw new Error("Missing generation");
    const coverageStatements = await counted.count(async () => {
      const prepared = await prepareDocumentOutgoingCoverage({
        currentDoc: f.document,
        generation,
        pendingUpdates,
        state: f.state,
      });
      expect(prepared?.pendingUpdates).toEqual(pendingUpdates);
    });
    console.info("atomic-edit-statements", {
      editStatements,
      editWorkerMessages,
      editAndCoverageMessages: editAndQueueReadMessages + db.statements.length,
      coverageStatements,
      workerMessages: db.statements.length,
    });
    expect(editStatements).toBeLessThanOrEqual(10);
    expect(editWorkerMessages).toBe(editStatements);
    expect(editAndQueueReadMessages + db.statements.length).toBeLessThanOrEqual(
      11,
    );
    expect(db.statements.length).toBe(coverageStatements);
    expect(f.state.record?.text).toBe("measured edit");
    expect(f.state.record?.pendingBaseVersion).toBe(
      encodeVersionVector(f.document),
    );
    expect(coverageStatements).toBe(0);
  } finally {
    await db.close();
    await db.remove();
  }
});

import { expect, test } from "bun:test";
import { encodeVersionVector } from "@tearleads/loro";
import {
  createAtomicEditFixture,
  ensureAtomicEditStoreReady,
} from "../../../../../test/helpers/atomicEditCoverage";
import { openFileBackedSql } from "../../../../../test/helpers/fileBackedSql";
import { sqlDocumentsPersistence as documents } from "../../../../data/persistence/documents/documentsPersistence";
import { createExecSql } from "../../../../data/sqlite/sqlSchema";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import { setDocumentText } from "../mutations";
import { runDocumentOrphanMaintenance } from "../orphanMaintenance";
import { createDocumentStoreState } from "../state";

test("atomic fixture readiness drains the other connection's maintenance transaction", async () => {
  const f = await createAtomicEditFixture("atomic-maintenance-barrier");
  const other = await openFileBackedSql(f.db.path);
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let inSweep = false;
  let ready = false;
  const execSql = createExecSql({
    async exec({ sql, bind, rowMode }) {
      if (inSweep && sql.toUpperCase() === "COMMIT") {
        reached.resolve();
        await release.promise;
      }
      return {
        rows: await other.execSql(sql, bind, { rowMode: rowMode ?? "object" }),
      };
    },
  });
  const second = createDocumentStoreState(
    f.localId,
    {
      ...f.state.runtime,
      infra: { ...f.state.runtime.infra, execSql },
    },
    {
      ...documents,
      orphanBlobs: {
        ...documents.orphanBlobs,
        async sweep(execSql) {
          inSweep = true;
          try {
            return await documents.orphanBlobs.sweep(execSql);
          } finally {
            inSweep = false;
          }
        },
      },
    },
    noopDocumentStorePersistenceEffects,
    "document-1",
  );
  const initialization = ensureAtomicEditStoreReady(second).then((result) => {
    ready = result;
    return result;
  });
  try {
    await Promise.race([
      reached.promise,
      initialization.then(() => {
        throw new Error("Fixture became ready before maintenance COMMIT");
      }),
    ]);
    // A real read transaction remains open, even when the sweep finds no rows.
    // Exposing this fixture now lets the first connection's COMMIT hit BUSY.
    expect(second.initialized).toBe(true);
    expect(ready).toBe(false);
    await setDocumentText(f.state, () => {}, "blocked by maintenance");
    expect(f.writeErrors).toHaveLength(1);
    expect(f.writeErrors[0]).toMatchObject({ message: "database is locked" });
    expect(f.state.unsavedLocalEdits).toBe(true);
    expect(f.state.record?.pendingBaseVersion).toBe(f.version);
    expect(
      (await documents.loadDocument(f.execSql, f.localId))?.pendingBaseVersion,
    ).toBe(f.version);
    expect(await documents.listPendingUpdates(f.execSql, f.localId)).toEqual(
      [],
    );
    release.resolve();
    expect(await initialization).toBe(true);
    await setDocumentText(f.state, () => {}, "retry after drain");
    expect(f.writeErrors).toHaveLength(1);
    expect(f.state.unsavedLocalEdits).toBe(false);
    expect(f.state.record?.pendingBaseVersion).toBe(
      encodeVersionVector(f.document),
    );
    expect(
      await documents.listPendingUpdates(f.execSql, f.localId),
    ).toHaveLength(1);
  } finally {
    release.resolve();
    await initialization.catch(() => undefined);
    // Also drain when the no-wait negative control exposes the fixture early.
    await runDocumentOrphanMaintenance(second);
    await other.close();
    await f.db.close();
    await f.db.remove();
    second.doc?.free();
    f.document.free();
  }
});

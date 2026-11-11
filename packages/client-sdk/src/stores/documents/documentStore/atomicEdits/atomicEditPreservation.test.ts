import { expect, test } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";
import {
  createAtomicEditFixture,
  ensureAtomicEditStoreReady,
  prepareAtomicCoverage,
} from "../../../../../test/helpers/atomicEditCoverage";
import { openFileBackedSql } from "../../../../../test/helpers/fileBackedSql";
import { readStoredDocumentState } from "../../../../data/documents/documentKinds";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import { sqlDocumentsPersistence as documents } from "../../../../data/persistence/documents/documentsPersistence";
import { createExecSql } from "../../../../data/sqlite/sqlSchema";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";

import { setDocumentStructuredFields, setDocumentText } from "../mutations";
import { pendingDeltaSinceBase, persistDocument } from "../persistence";
import { createDocumentStoreState } from "../state";

test.each(["document_history_updates", "document_projection"])(
  "%s failure rolls back queue, projection and coverage; retry retains the edits",
  async (table) => {
    const f = await createAtomicEditFixture(`atomic-failure-${table}`);
    try {
      const baseline = exportFullHistorySnapshot(f.document);
      const before = await documents.loadDocument(f.execSql, f.localId);
      await f.execSql(
        `CREATE TEMP TRIGGER fail_edit BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected edit failure'); END`,
      );
      await setDocumentText(f.state, () => {}, "failed edit");
      expect(f.writeErrors).toHaveLength(1);
      expect(f.writeErrors[0]).toMatchObject({
        cause: { message: "injected edit failure" },
      });
      expect(f.state.unsavedLocalEdits).toBe(true);
      expect(f.state.pendingBaseVersion).toBe(f.version);
      expect(await documents.loadDocument(f.execSql, f.localId)).toEqual(
        before,
      );
      expect(await documents.listPendingUpdates(f.execSql, f.localId)).toEqual(
        [],
      );
      await f.execSql("DROP TRIGGER fail_edit");
      await setDocumentText(f.state, () => {}, "failed edit plus retry");
      expect(f.state.unsavedLocalEdits).toBe(false);
      expect(f.state.record?.pendingBaseVersion).toBe(
        encodeVersionVector(f.document),
      );
      const prepared = await prepareAtomicCoverage(f.state);
      expect(prepared?.pendingUpdates).toHaveLength(1);
      const peer = await createDocument(`failure-peer-${table}`);
      importSnapshot(peer, baseline);
      importUpdates(
        peer,
        prepared.pendingUpdates.map(({ updateData }) =>
          base64ToBytes(updateData),
        ),
      );
      expect(peer.getText("text").toString()).toBe("failed edit plus retry");
    } finally {
      await f.db.close();
      await f.db.remove();
    }
  },
);

test("coverage claims only the captured queued delta, not later live edits", async () => {
  const f = await createAtomicEditFixture("atomic-captured-version");
  try {
    f.document.getText("text").update("queued edit");
    const pendingUpdate = createPendingUpdateFields(
      pendingDeltaSinceBase(f.state, f.document),
    );
    if (!pendingUpdate) throw new Error("Missing queued delta");
    const coveredVersion = encodeVersionVector(f.document);
    f.document.getText("text").update("later unqueued edit");
    await persistDocument(
      f.state,
      f.document,
      { snapshotEndVersion: coveredVersion },
      { pendingUpdate },
    );
    expect(f.state.record?.pendingBaseVersion).toBe(coveredVersion);
    expect(f.state.record?.pendingBaseVersion).not.toBe(
      encodeVersionVector(f.document),
    );
    // The next pass must enqueue the genuinely new tail, not clean-skip it.
    expect((await prepareAtomicCoverage(f.state))?.pendingUpdates).toHaveLength(
      2,
    );
  } finally {
    await f.db.close();
    await f.db.remove();
  }
});

test("the in-memory and cross-connection markers stay behind until COMMIT", async () => {
  const f = await createAtomicEditFixture("atomic-before-commit");
  const observer = await openFileBackedSql(f.db.path);
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let edit: Promise<void> | undefined;
  const execSql = createExecSql({
    async exec({ sql, bind, rowMode }) {
      if (sql === "COMMIT") {
        reached.resolve();
        await release.promise;
      }
      return {
        rows: await f.execSql(sql, bind, { rowMode: rowMode ?? "object" }),
      };
    },
  });
  f.state.runtime = {
    ...f.state.runtime,
    infra: { ...f.state.runtime.infra, execSql },
  };
  try {
    edit = setDocumentText(f.state, () => {}, "held commit");
    await reached.promise;
    expect(f.state.pendingBaseVersion).toBe(f.version);
    expect(
      (await documents.loadDocument(observer.execSql, f.localId))
        ?.pendingBaseVersion,
    ).toBe(f.version);
    expect(
      await documents.listPendingUpdates(observer.execSql, f.localId),
    ).toEqual([]);
    release.resolve();
    await edit;
    expect(
      (await documents.loadDocument(observer.execSql, f.localId))
        ?.pendingBaseVersion,
    ).toBe(encodeVersionVector(f.document));
    expect(
      await documents.listPendingUpdates(observer.execSql, f.localId),
    ).toHaveLength(1);
  } finally {
    release.resolve();
    await edit;
    await observer.close();
    await f.db.close();
    await f.db.remove();
  }
});

test("coverage reconciles a foreign queued edit even when this tab's marker is current", async () => {
  const f = await createAtomicEditFixture("atomic-stale-coverage");
  const other = await openFileBackedSql(f.db.path);
  try {
    await setDocumentText(f.state, () => {}, "first runtime");
    const second = createDocumentStoreState(
      f.localId,
      {
        ...f.state.runtime,
        infra: { ...f.state.runtime.infra, execSql: other.execSql },
      },
      documents,
      noopDocumentStorePersistenceEffects,
      "document-1",
    );
    expect(await ensureAtomicEditStoreReady(second)).toBe(true);
    await setDocumentStructuredFields(second, () => {}, "contact", {
      firstName: "second runtime",
    });
    expect(
      readStoredDocumentState(f.document).structuredFields,
    ).not.toMatchObject({ firstName: "second runtime" });
    const prepared = await prepareAtomicCoverage(f.state);
    expect(prepared.pendingUpdates).toHaveLength(2);
    expect(f.writeErrors).toEqual([]);
    expect(readStoredDocumentState(f.document).structuredFields).toMatchObject({
      firstName: "second runtime",
    });
    expect(f.state.record?.pendingBaseVersion).toBe(
      encodeVersionVector(f.document),
    );
  } finally {
    await other.close();
    await f.db.close();
    await f.db.remove();
  }
});

test("a stale tab merges the other connection's covered frontier and projection", async () => {
  const f = await createAtomicEditFixture("atomic-cross-connection");
  const other = await openFileBackedSql(f.db.path);
  try {
    const baseline = exportFullHistorySnapshot(f.document);
    const second = createDocumentStoreState(
      f.localId,
      {
        ...f.state.runtime,
        infra: { ...f.state.runtime.infra, execSql: other.execSql },
      },
      documents,
      noopDocumentStorePersistenceEffects,
      "document-1",
    );
    expect(await ensureAtomicEditStoreReady(second)).toBe(true);
    await setDocumentStructuredFields(second, () => {}, "contact", {
      firstName: "other tab",
    });
    await setDocumentText(f.state, () => {}, "stale tab edit");
    expect(f.writeErrors).toEqual([]);
    expect(f.state.record?.pendingBaseVersion).toBe(
      encodeVersionVector(f.document),
    );
    expect(readStoredDocumentState(f.document).structuredFields).toMatchObject({
      firstName: "other tab",
    });
    const prepared = await prepareAtomicCoverage(f.state);
    expect(prepared?.pendingUpdates).toHaveLength(2);
    const peer = await createDocument("cross-tab-peer");
    importSnapshot(peer, baseline);
    importUpdates(
      peer,
      prepared.pendingUpdates.map(({ updateData }) =>
        base64ToBytes(updateData),
      ),
    );
    expect(peer.getText("text").toString()).toBe("stale tab edit");
    expect(readStoredDocumentState(peer).structuredFields).toMatchObject({
      firstName: "other tab",
    });
  } finally {
    await other.close();
    await f.db.close();
    await f.db.remove();
  }
});

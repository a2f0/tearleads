import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import {
  documentProjection,
  documentProjectionText,
  documents,
} from "../../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import { createExecSql, type ExecSql } from "../../../sqlite/sqlSchema";
import { sqlDocumentsPersistence } from "../documentsPersistence";
import type { StoredDocumentRecord } from "../types";
import { resolveDocumentSaveTimestamp, saveDocumentRows } from "./documentRows";

const savedAt = "2026-04-05T00:00:00.000Z";
const base = {
  accessEpoch: 1,
  containerId: "container",
  documentId: "document",
  id: "local-document",
  snapshotEndVersion: "base-version",
  text: "base",
};

async function documentFixture(recoveryGeneration?: number) {
  const sqlite = await createTestExecSql("document-rows");
  await sqlDocumentsPersistence.ensureSchema(sqlite.execSql);
  if (recoveryGeneration !== undefined)
    await sqlDocumentsPersistence.saveDocument(
      sqlite.execSql,
      { ...base, recoveryGeneration },
      { updatedAt: savedAt },
    );
  const runtime = getClientSQLitePersistenceRuntime(sqlite.execSql);
  const stored = await sqlDocumentsPersistence.loadDocument(
    sqlite.execSql,
    base.id,
  );
  const record: StoredDocumentRecord = stored ?? base;
  const snapshot = async () => ({
    documents: await runtime.db
      .select()
      .from(documents)
      .where(eq(documents.localId, base.id)),
    projection: await runtime.db
      .select()
      .from(documentProjection)
      .where(eq(documentProjection.localId, base.id)),
    text: await runtime.db
      .select()
      .from(documentProjectionText)
      .where(eq(documentProjectionText.localId, base.id)),
  });
  const save = (document: StoredDocumentRecord) =>
    runtime.transaction((tx) =>
      saveDocumentRows({ document, tx, updatedAt: "2026-04-06T00:00:00.000Z" }),
    );
  const timestamp = (document: StoredDocumentRecord) =>
    runtime.transaction((tx) => resolveDocumentSaveTimestamp({ document, tx }));
  return { ...sqlite, runtime, record, snapshot, save, timestamp };
}

/** A record from a writer that sets this generation, or none at all. */
function withGeneration(
  record: StoredDocumentRecord,
  recoveryGeneration: number | undefined,
): StoredDocumentRecord {
  const { recoveryGeneration: _stored, ...rest } = record;
  return recoveryGeneration === undefined
    ? rest
    : { ...rest, recoveryGeneration };
}

test("a save from an older recovery generation leaves every row untouched", async () => {
  for (const [stored, incoming] of [
    [2, 1],
    [1, undefined],
  ] as const) {
    const f = await documentFixture(stored);
    try {
      const before = await f.snapshot();
      expect(
        await f.save({ ...withGeneration(f.record, incoming), text: "stale" }),
      ).toBe(false);
      expect(await f.snapshot()).toEqual(before);
    } finally {
      f.close();
    }
  }
});

test("a save from the same or a newer recovery generation writes the rows", async () => {
  for (const [stored, incoming] of [
    [0, undefined],
    [1, 1],
    [1, 2],
  ] as const) {
    const f = await documentFixture(stored);
    try {
      expect(
        await f.save({ ...withGeneration(f.record, incoming), text: "next" }),
      ).toBe(true);
      const after = await f.snapshot();
      expect(after.documents[0]?.recoveryGeneration).toBe(incoming ?? 0);
      expect(after.text[0]?.text).toBe("next");
    } finally {
      f.close();
    }
  }
});

test("a save without a stored row inserts it", async () => {
  const f = await documentFixture();
  try {
    expect(await f.save(f.record)).toBe(true);
    const after = await f.snapshot();
    expect(after.documents).toHaveLength(1);
    expect(after.projection).toHaveLength(1);
  } finally {
    f.close();
  }
});

test("the save timestamp keeps the stored time only for unchanged content", async () => {
  const f = await documentFixture(0);
  try {
    expect(await f.timestamp(f.record)).toBe(savedAt);
    expect(await f.timestamp({ ...f.record, text: "changed" })).not.toBe(
      savedAt,
    );
    expect(
      await f.timestamp({ ...f.record, snapshotEndVersion: "next-version" }),
    ).not.toBe(savedAt);
    expect(await f.timestamp({ ...f.record, id: "missing" })).not.toBe(savedAt);
    // Missing projection text reads as empty text, which differs from "base".
    await f.runtime.db.delete(documentProjectionText).run();
    expect(await f.timestamp(f.record)).not.toBe(savedAt);
    // A document row without its projection always takes a new timestamp.
    await f.runtime.db.delete(documentProjection).run();
    expect(await f.timestamp({ ...f.record, text: "" })).not.toBe(savedAt);
  } finally {
    f.close();
  }
});

function countingExecSql(execSql: ExecSql) {
  const counter = { statements: 0 };
  return {
    counter,
    execSql: createExecSql({
      async exec({ sql, bind, rowMode }) {
        counter.statements += 1;
        const rows =
          rowMode === "array"
            ? await execSql(sql, bind, { rowMode: "array" })
            : await execSql(sql, bind);
        return { rows };
      },
    }),
  };
}

test("a plain document edit commits in seven statements", async () => {
  const f = await documentFixture(0);
  try {
    const counted = countingExecSql(f.execSql);
    const edit = async (sequence: number) => {
      const expectedRecord = await sqlDocumentsPersistence.loadDocument(
        counted.execSql,
        base.id,
      );
      if (!expectedRecord) throw new Error("Missing stored document");
      counted.counter.statements = 0;
      const result = await sqlDocumentsPersistence.commitDocumentMutation(
        counted.execSql,
        {
          acceptedPendingUpdateIds: [],
          document: {
            ...expectedRecord,
            snapshotEndVersion: `version-${sequence}`,
          },
          expectedRecord,
          pendingUpdate: {
            partialEndVersionVector: `end-${sequence}`,
            partialStartVersionVector: `start-${sequence}`,
            sourceVersionVector: null,
            updateData: btoa(`update-${sequence}`),
          },
          settleAcceptedPendingOnConflict: false,
        },
        async () => undefined,
      );
      expect(result.committed).toBe(true);
      return counted.counter.statements;
    };
    await edit(1);
    // BEGIN IMMEDIATE, the joined document load, the pending-update insert,
    // the guarded document upsert, projection and text upserts, COMMIT. The
    // save timestamp comes from the load (was 9).
    expect(await edit(2)).toBe(7);
  } finally {
    f.close();
  }
});

test("a committed mutation keeps the stored time only for unchanged content", async () => {
  const f = await documentFixture(0);
  try {
    const commit = async (patch: Partial<StoredDocumentRecord>) => {
      const expectedRecord = await sqlDocumentsPersistence.loadDocument(
        f.execSql,
        base.id,
      );
      if (!expectedRecord) throw new Error("Missing stored document");
      const result = await sqlDocumentsPersistence.commitDocumentMutation(
        f.execSql,
        {
          acceptedPendingUpdateIds: [],
          document: { ...expectedRecord, ...patch },
          expectedRecord,
          settleAcceptedPendingOnConflict: false,
        },
        async () => undefined,
      );
      if (!result.committed) throw new Error("Expected a committed mutation");
      return result.updatedAt;
    };
    // Unchanged content keeps the time the transaction's own load read.
    expect(await commit({ accessEpoch: 2 })).toBe(savedAt);
    expect(await commit({ text: "changed" })).not.toBe(savedAt);
    const second = await documentFixture(0);
    try {
      // A projection lost under the record always takes a new time, even
      // when the loaded record's defaults match the incoming content.
      await second.runtime.db.delete(documentProjection).run();
      const expectedRecord = await sqlDocumentsPersistence.loadDocument(
        second.execSql,
        base.id,
      );
      if (!expectedRecord) throw new Error("Missing stored document");
      const result = await sqlDocumentsPersistence.commitDocumentMutation(
        second.execSql,
        {
          acceptedPendingUpdateIds: [],
          document: expectedRecord,
          expectedRecord,
          settleAcceptedPendingOnConflict: false,
        },
        async () => undefined,
      );
      expect(result.committed && result.updatedAt).not.toBe(savedAt);
      expect(result.committed).toBe(true);
    } finally {
      second.close();
    }
  } finally {
    f.close();
  }
});

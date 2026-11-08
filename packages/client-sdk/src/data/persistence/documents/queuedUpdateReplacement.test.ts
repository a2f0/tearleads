import { expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  exportUpdatesInVersionRange,
  exportUpdatesSince,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";
import { createTestExecSql, type TestExecSql } from "@tearleads/test-utils";
import type { DocumentState } from "../../../stores/documents/documentStore/state";
import { createPendingUpdateFields } from "../../documents/documentSync";
import { sqlDocumentsPersistence as persistence } from "./documentsPersistence";
import { getDocumentScope } from "./internal/documentRows";
import type { ReplaceQueuedPendingUpdatesInput } from "./queuedUpdateReplacementPort";
import { enqueueDocumentPendingUpdate } from "./records";

const LOCAL_ID = "local-merge-document";
const DOCUMENT_ID = "document-merge";

async function createStoredDocument(
  execSql: TestExecSql,
): Promise<DocumentState> {
  await persistence.ensureSchema(execSql);
  const doc = await createDocument("queued-replacement-writer");
  doc.getText("text").update("base");
  doc.commit();
  const version = encodeVersionVector(doc);
  await persistence.createDocumentWithHistoryCheckpoint(
    execSql,
    {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: DOCUMENT_ID,
      id: LOCAL_ID,
      snapshotEndVersion: version,
      text: "base",
    },
    {
      endVersionVector: version,
      snapshot: bytesToBase64(exportFullHistorySnapshot(doc)),
    },
    undefined,
    async () => undefined,
  );
  return doc;
}

async function enqueueEdit(
  execSql: TestExecSql,
  doc: DocumentState,
  sourceVersionVector?: string,
): Promise<string> {
  const before = encodeVersionVector(doc);
  const text = doc.getText("text");
  text.insert(text.length, "x");
  doc.commit();
  const fields = createPendingUpdateFields(exportUpdatesSince(doc, before));
  if (!fields) throw new Error("expected an update");
  await persistence.enqueuePendingUpdate(execSql, {
    localId: LOCAL_ID,
    ...fields,
    ...(sourceVersionVector === undefined ? {} : { sourceVersionVector }),
  });
  const queued = await persistence.listPendingUpdates(execSql, LOCAL_ID);
  return queued.at(-1)?.id ?? "";
}

/** A raw `document_history_updates` row, as SQLite returns it. */
interface LogRow {
  created_at?: unknown;
  id?: unknown;
  origin?: unknown;
  rekey_count?: unknown;
  rowid?: unknown;
  update_data?: unknown;
  update_id?: unknown;
}

async function readRows(execSql: TestExecSql): Promise<LogRow[]> {
  return (await execSql(
    "SELECT rowid, id, created_at, update_id, update_data, origin, rekey_count FROM document_history_updates ORDER BY rowid",
  )) as LogRow[];
}

async function mergedFields(
  execSql: TestExecSql,
  doc: DocumentState,
  ids: string[],
) {
  const queued = await persistence.listPendingUpdates(execSql, LOCAL_ID);
  const members = ids.map((id) => queued.find((row) => row.id === id));
  const start = members[0]?.partialStartVersionVector ?? "";
  const end = members.at(-1)?.partialEndVersionVector ?? "";
  const blob = exportUpdatesInVersionRange(doc, start, end);
  const fields = blob ? createPendingUpdateFields(blob) : null;
  if (!fields) throw new Error("expected merged fields");
  return {
    partialEndVersionVector: fields.partialEndVersionVector,
    partialStartVersionVector: fields.partialStartVersionVector,
    updateData: fields.updateData,
  };
}

function replacement(
  memberUpdateIds: string[],
  merged: ReplaceQueuedPendingUpdatesInput["merged"],
  overrides: Partial<ReplaceQueuedPendingUpdatesInput> = {},
): ReplaceQueuedPendingUpdatesInput {
  return {
    expectedDocumentId: DOCUMENT_ID,
    expectedRecoveryGeneration: 0,
    localId: LOCAL_ID,
    memberUpdateIds,
    merged,
    rekeyCount: 3,
    ...overrides,
  };
}

async function restoredHistory(execSql: TestExecSql) {
  const restore = await persistence.loadHistoryRestoreState(execSql, LOCAL_ID);
  if (!restore) throw new Error("expected history");
  const doc = await createDocument("queued-replacement-restore");
  importSnapshot(doc, base64ToBytes(restore.snapshot));
  importUpdates(
    doc,
    restore.tailUpdates.map((update) => base64ToBytes(update.updateData)),
  );
  return {
    identity: exportFullHistoryIdentity(doc),
    text: doc.getText("text").toString(),
    version: encodeVersionVector(doc),
  };
}

test("a merge replaces the first member in place with a fresh id", async () => {
  const { close, execSql } = await createTestExecSql("queued-replace-success");
  try {
    const doc = await createStoredDocument(execSql);
    const ids = [
      await enqueueEdit(execSql, doc),
      await enqueueEdit(execSql, doc),
      await enqueueEdit(execSql, doc),
    ];
    const merged = await mergedFields(execSql, doc, ids);
    const later = await enqueueEdit(execSql, doc);
    const before = await readRows(execSql);
    const historyBefore = await restoredHistory(execSql);
    const first = before.find((row) => row.update_id === ids[0]);

    const updateId = await persistence.replaceQueuedPendingUpdates(
      execSql,
      replacement(ids, merged),
    );

    if (updateId === null) throw new Error("expected the merge to apply");
    expect([...ids, later]).not.toContain(updateId);
    const after = await readRows(execSql);
    expect(after.filter((row) => row.origin === "local")).toEqual([
      {
        ...first,
        rekey_count: 3,
        update_data: merged.updateData,
        update_id: updateId,
      },
      expect.objectContaining({ update_id: later }),
    ]);
    const queued = await persistence.listPendingUpdates(execSql, LOCAL_ID);
    expect(queued.map((row) => row.id)).toEqual([updateId, later]);
    expect(queued[0]).toMatchObject({ ...merged, origin: "local" });
    // Restoring checkpoint + tail rebuilds the same oplog.
    expect(await restoredHistory(execSql)).toEqual(historyBefore);
    expect(historyBefore.version).toBe(encodeVersionVector(doc));
  } finally {
    close();
  }
});

test("compaction never folds a merged queued row", async () => {
  const { close, execSql } = await createTestExecSql("queued-replace-compact");
  try {
    const doc = await createStoredDocument(execSql);
    const ids = [
      await enqueueEdit(execSql, doc),
      await enqueueEdit(execSql, doc),
    ];
    const updateId = await persistence.replaceQueuedPendingUpdates(
      execSql,
      replacement(ids, await mergedFields(execSql, doc, ids)),
    );
    if (updateId === null) throw new Error("expected the merge to apply");
    const [mergedRow] = (await readRows(execSql)).filter(
      (row) => row.update_id === updateId,
    );

    expect(await persistence.listHistoryTailEntries(execSql, LOCAL_ID)).toEqual(
      [],
    );
    await persistence.replaceHistoryCheckpoint(execSql, {
      coveredTailIds: [String(mergedRow?.id)],
      endVersionVector: encodeVersionVector(doc),
      force: true,
      localId: LOCAL_ID,
      snapshot: bytesToBase64(exportFullHistorySnapshot(doc)),
    });
    expect(
      (await persistence.listPendingUpdates(execSql, LOCAL_ID)).map(
        (row) => row.id,
      ),
    ).toEqual([updateId]);
  } finally {
    close();
  }
});

const PRECONDITION_MISSES: {
  name: string;
  input: (queue: {
    a: string;
    b: string;
    c: string;
    checkpoint: string;
    outbox: string;
    d: string;
  }) => {
    members: string[];
    overrides?: Partial<ReplaceQueuedPendingUpdatesInput>;
  };
  settleB?: true;
}[] = [
  {
    name: "wrong document id",
    input: (q) => ({
      members: [q.a, q.b],
      overrides: { expectedDocumentId: "another-document" },
    }),
  },
  {
    name: "wrong recovery generation",
    input: (q) => ({
      members: [q.a, q.b],
      overrides: { expectedRecoveryGeneration: 1 },
    }),
  },
  { name: "missing member", input: (q) => ({ members: [q.a, "missing"] }) },
  {
    name: "settled member",
    input: (q) => ({ members: [q.a, q.b] }),
    settleB: true,
  },
  {
    name: "checkpoint member",
    input: (q) => ({ members: [q.c, q.checkpoint] }),
  },
  { name: "outbox member", input: (q) => ({ members: [q.outbox, q.d] }) },
  { name: "non-contiguous members", input: (q) => ({ members: [q.a, q.c] }) },
  { name: "wrong first member", input: (q) => ({ members: [q.b, q.a] }) },
  { name: "single member", input: (q) => ({ members: [q.a] }) },
];

for (const miss of PRECONDITION_MISSES) {
  test(`a merge with a ${miss.name} changes nothing`, async () => {
    const { close, execSql } = await createTestExecSql(
      `queued-replace-${miss.name.replaceAll(" ", "-")}`,
    );
    try {
      const doc = await createStoredDocument(execSql);
      const a = await enqueueEdit(execSql, doc);
      const b = await enqueueEdit(execSql, doc);
      const c = await enqueueEdit(execSql, doc);
      const checkpoint = await enqueueEdit(
        execSql,
        doc,
        encodeVersionVector(doc),
      );
      const outboxFields = await mergedFields(execSql, doc, [a, c]);
      const outbox = await enqueueDocumentPendingUpdate(
        execSql,
        getDocumentScope(LOCAL_ID),
        outboxFields,
      );
      const d = await enqueueEdit(execSql, doc);
      if (miss.settleB) await persistence.deletePendingUpdate(execSql, b);
      const { members, overrides } = miss.input({
        a,
        b,
        c,
        checkpoint,
        d,
        outbox,
      });
      const before = await readRows(execSql);

      await expect(
        persistence.replaceQueuedPendingUpdates(
          execSql,
          replacement(members, outboxFields, overrides),
        ),
      ).resolves.toBeNull();
      expect(await readRows(execSql)).toEqual(before);
    } finally {
      close();
    }
  });
}

import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createDocument,
  decodeVersionVector,
  encodeVersionVectorCounters,
  exportAllUpdates,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultDocumentProjectorRegistry } from "../../documents/documentKinds";
import { createPendingUpdateFields } from "../../documents/documentSync";
import { committedSpansVersion } from "../../documents/shared/sync/peerRebase";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { sqlDocumentsPersistence } from "./documentsPersistence";
import type { StoredDocumentRecord } from "./types";

const LOCAL_ID = "note";
const WRITER = "11";
const OTHER = "22";

let execSql: ExecSql;
let close: () => void;

beforeEach(async () => {
  ({ close, execSql } = await createTestExecSql("document-committed-version"));
  await sqlDocumentsPersistence.ensureSchema(execSql);
  await sqlDocumentsPersistence.saveDocument(execSql, {
    accessEpoch: 1,
    containerId: "container",
    documentId: "remote-note",
    id: LOCAL_ID,
    snapshotEndVersion: "frontier",
    text: "hello",
  });
});

afterEach(() => close());

async function storedRecord(): Promise<StoredDocumentRecord> {
  const record = await sqlDocumentsPersistence.loadDocument(execSql, LOCAL_ID);
  if (!record) throw new Error("expected the stored record");
  return record;
}

async function committedCounters(): Promise<Record<string, number>> {
  const { committedVersion } = await storedRecord();
  return Object.fromEntries(decodeVersionVector(committedVersion).toJSON());
}

/** Queues "hello": five operations on one peer, from counter zero. */
async function queueEdit() {
  const doc = await createDocument("writer");
  doc.setPeerId(WRITER);
  doc.getText("text").insert(0, "hello");
  doc.commit();
  const fields = createPendingUpdateFields(exportAllUpdates(doc));
  doc.free();
  if (!fields) throw new Error("expected an update");
  await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
    ...fields,
    localId: LOCAL_ID,
  });
  const [queued] = await sqlDocumentsPersistence.listPendingUpdates(
    execSql,
    LOCAL_ID,
  );
  if (!queued) throw new Error("expected the queued update");
  const version = committedSpansVersion([queued]);
  if (version === null) throw new Error("expected the update's span");
  return { id: queued.id, version };
}

function settle(committedVersions: string[], pendingUpdateIds: string[] = []) {
  return storedRecord().then((expectedRecord) =>
    sqlDocumentsPersistence.settleAcceptedPendingUpdates(execSql, {
      committedVersions,
      expectedRecord,
      pendingUpdateIds,
    }),
  );
}

test("a record that has settled no response knows nothing committed", async () => {
  await queueEdit();

  expect((await storedRecord()).committedVersion).toBeUndefined();
});

test("a settlement raises it and never lowers a peer", async () => {
  const hello = await queueEdit();

  // The server acknowledged the edit and served three operations of another
  // peer in the same response.
  await settle(
    [hello.version, encodeVersionVectorCounters({ [OTHER]: 3 })],
    [hello.id],
  );
  expect(await committedCounters()).toEqual({ [OTHER]: 3, [WRITER]: 5 });
  expect(
    await sqlDocumentsPersistence.listPendingUpdates(execSql, LOCAL_ID),
  ).toEqual([]);

  // A later response that shows less changes nothing.
  await settle([encodeVersionVectorCounters({ [OTHER]: 1, [WRITER]: 2 })]);
  expect(await committedCounters()).toEqual({ [OTHER]: 3, [WRITER]: 5 });

  await settle([encodeVersionVectorCounters({ [OTHER]: 9 })]);
  expect(await committedCounters()).toEqual({ [OTHER]: 9, [WRITER]: 5 });
});

test("a save from a record that predates the settlement does not lower it", async () => {
  const hello = await queueEdit();
  const beforeSettlement = await storedRecord();
  await settle([hello.version], [hello.id]);

  // A store's record in memory still has no committed version.
  await sqlDocumentsPersistence.saveDocument(execSql, {
    ...beforeSettlement,
    text: "hello again",
  });
  const committed = await sqlDocumentsPersistence.commitDocumentMutation(
    execSql,
    {
      acceptedPendingUpdateIds: [],
      document: { ...beforeSettlement, text: "hello once more" },
      expectedRecord: await storedRecord(),
      settleAcceptedPendingOnConflict: false,
    },
    async () => undefined,
  );

  expect(committed.committed).toBe(true);
  expect((await storedRecord()).text).toBe("hello once more");
  expect(await committedCounters()).toEqual({ [WRITER]: 5 });
});

test("a committed response records what it showed with its save", async () => {
  const hello = await queueEdit();
  const requestRecord = await storedRecord();

  const committed = await sqlDocumentsPersistence.commitDocumentMutation(
    execSql,
    {
      acceptedPendingUpdateIds: [hello.id],
      committedVersions: [hello.version],
      document: { ...requestRecord, lastCommitLsn: "0/10" },
      expectedRecord: requestRecord,
      settleAcceptedPendingOnConflict: true,
    },
    async () => undefined,
  );

  expect(committed.committed).toBe(true);
  expect((await storedRecord()).lastCommitLsn).toBe("0/10");
  expect(await committedCounters()).toEqual({ [WRITER]: 5 });
});

test("a response that loses its comparison still records what it showed", async () => {
  const hello = await queueEdit();
  const requestRecord = await storedRecord();
  // Another pane saved while the request was out.
  await sqlDocumentsPersistence.saveDocument(execSql, {
    ...requestRecord,
    snapshotEndVersion: "later-frontier",
  });

  const committed = await sqlDocumentsPersistence.commitDocumentMutation(
    execSql,
    {
      acceptedPendingUpdateIds: [hello.id],
      committedVersions: [
        hello.version,
        encodeVersionVectorCounters({ [OTHER]: 3 }),
      ],
      document: requestRecord,
      expectedRecord: requestRecord,
      settleAcceptedPendingOnConflict: true,
    },
    async () => undefined,
  );

  expect(committed.committed).toBe(false);
  expect(await committedCounters()).toEqual({ [OTHER]: 3, [WRITER]: 5 });
});

test("a response for another server document records nothing", async () => {
  const hello = await queueEdit();
  const requestRecord = await storedRecord();
  await sqlDocumentsPersistence.saveDocument(execSql, {
    ...requestRecord,
    accessEpoch: 2,
  });

  await sqlDocumentsPersistence.settleAcceptedPendingUpdates(execSql, {
    committedVersions: [hello.version],
    expectedRecord: requestRecord,
    pendingUpdateIds: [hello.id],
  });

  expect((await storedRecord()).committedVersion).toBeUndefined();
});

test("a discard forgets it with the history it described", async () => {
  const hello = await queueEdit();
  await settle([hello.version], [hello.id]);
  expect(await committedCounters()).toEqual({ [WRITER]: 5 });

  const discarded = await sqlDocumentsPersistence.discardDocumentToShell?.(
    execSql,
    LOCAL_ID,
    "remote-note",
    defaultDocumentProjectorRegistry,
  );

  expect(discarded).toMatchObject({ discarded: true });
  expect((await storedRecord()).committedVersion).toBeUndefined();
});

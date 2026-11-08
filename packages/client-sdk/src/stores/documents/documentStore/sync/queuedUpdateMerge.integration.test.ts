import { expect, test } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";
import {
  createDocument,
  decodeVersionVector,
  encodeVersionVector,
  exportUpdatesSince,
  getTextValue,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";
import {
  createMockApiClient,
  createMockRequestFailure,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  type DocumentSyncResponse,
} from "@tearleads/validators/response";
import {
  createMaterializedSyncFixture,
  createResponseFromRequest,
  type DocumentCreateFixture,
} from "../../../../../test/helpers/documentFixtures";
import {
  createEchoDocumentSyncResponse,
  createOnlineDocumentsRuntime,
  createStoredDocumentWriterProjection,
} from "../../../../../test/helpers/onlineDocumentStoreFixtures";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import { getDocumentScope } from "../../../../data/persistence/documents/internal/documentRows";
import { enqueueDocumentPendingUpdateWithHistory } from "../../../../data/persistence/documents/records";
import { createDomainScope } from "../../../../data/shared/domainScope";
import {
  type DocumentsPersistence,
  defaultDocumentsPersistence,
  listPendingDocumentUpdates,
} from "../../../../workflows/documents";
import type { DocumentStore, DocumentsRuntime } from "../../types";
import { createDocumentStore } from "../index";

type ExecSql = DocumentsRuntime["infra"]["execSql"];

/** How the fake server answers one submission that carries updates. */
type SubmitOutcome = "accept" | "commitAndLoseAck" | "conflict";

/** A merged queued row the store wrote, as the persistence port saw it. */
interface MergedRow {
  readonly updateData: string;
  readonly updateId: string;
}

/**
 * A fake documents server that stores what it commits, plus a persistence
 * wrapper that records every merged row the store writes.
 */
async function createMergeHarness(name: string) {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(name);
  const submissions: DocumentSyncRequest[] = [];
  const committed: DocumentSyncResponse["updates"] = [];
  const merges: MergedRow[] = [];
  const outcomes: SubmitOutcome[] = [];
  const logs: string[] = [];
  const control = { failMerges: false };
  let storedDocument: DocumentCreateFixture | null = null;
  const echoFor = (request: DocumentSyncRequest) => {
    if (!storedDocument) throw new Error("document not created");
    return createEchoDocumentSyncResponse({
      commitLsn: `0/${submissions.length + 1}0`,
      request,
      storedDocument,
    });
  };
  const apiClient = createMockApiClient({
    async createDocument(
      request: Parameters<typeof createResponseFromRequest>[0],
    ) {
      storedDocument = await createResponseFromRequest(request);
      return storedDocument;
    },
    getContainerWriterProjection: async () => fixture.projection,
    getDocumentWriterProjection: async () =>
      storedDocument
        ? createStoredDocumentWriterProjection(fixture, storedDocument)
        : null,
    async syncDocumentResult(documentId: string, request: DocumentSyncRequest) {
      const echo = echoFor(request);
      if (request.outgoingUpdates.length === 0) {
        return { data: { ...echo, updates: [...committed] }, ok: true };
      }
      submissions.push(request);
      const outcome = outcomes.shift() ?? "accept";
      if (outcome === "conflict") {
        return createMockRequestFailure({
          code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
          message: `POST /documents/${documentId}/sync: 409 Conflict: Document update id conflict`,
          status: 409,
        });
      }
      committed.push(...echo.updates);
      if (outcome === "commitAndLoseAck") {
        throw new Error("connection reset after commit");
      }
      return { data: { ...echo, updates: [...committed] }, ok: true };
    },
  });
  const base = createOnlineDocumentsRuntime({ apiClient, execSql, fixture });
  const online: DocumentsRuntime = {
    ...base,
    util: {
      ...base.util,
      log: (message) => {
        logs.push(message);
      },
    },
  };
  const offline: DocumentsRuntime = {
    ...online,
    state: { ...online.state, online: false },
  };
  const persistence: DocumentsPersistence = {
    ...defaultDocumentsPersistence,
    async replaceQueuedPendingUpdates(...args) {
      if (control.failMerges) throw new Error("replace failed");
      const updateId =
        await defaultDocumentsPersistence.replaceQueuedPendingUpdates(...args);
      if (updateId !== null) {
        merges.push({ updateData: args[1].merged.updateData, updateId });
      }
      return updateId;
    },
  };
  return {
    close,
    committed,
    control,
    execSql,
    logs,
    merges,
    offline,
    online,
    outcomes,
    persistence,
    submissions,
  };
}

function queued(execSql: ExecSql, localId: string) {
  return listPendingDocumentUpdates({
    execSql,
    localId,
    persistence: defaultDocumentsPersistence,
  });
}

async function textOf(updateData: string): Promise<string> {
  const peer = await createDocument("merge-peer");
  importUpdates(peer, [base64ToBytes(updateData)]);
  return getTextValue(peer);
}

const TYPED = "merged offline note";

async function typeOffline(
  harness: {
    readonly offline: DocumentsRuntime;
    readonly persistence: DocumentsPersistence;
  },
  localId: string,
  text: string,
  from = 1,
) {
  const store = createDocumentStore(
    localId,
    harness.offline,
    harness.persistence,
    null,
    "",
    "note",
  );
  expect(await store.ensureInitialized()).toBe(true);
  for (let length = from; length <= text.length; length += 1) {
    await store.setText(text.slice(0, length));
  }
  return store;
}

function outgoingIds(submissions: readonly DocumentSyncRequest[]) {
  return submissions.map((request) =>
    request.outgoingUpdates.map((update) => update.id),
  );
}

/** The single merged row the store wrote. */
function onlyMerge(harness: { readonly merges: readonly MergedRow[] }) {
  expect(harness.merges).toHaveLength(1);
  const [merge] = harness.merges;
  if (!merge) throw new Error("expected one merged row");
  return merge;
}

test("offline edits go out as one update once the store is online", async () => {
  const harness = await createMergeHarness("queued-merge-offline");
  const localId = "queued-merge-offline";
  try {
    const store = await typeOffline(harness, localId, TYPED);
    const backlog = await queued(harness.execSql, localId);
    expect(backlog.length).toBeGreaterThanOrEqual(TYPED.length);

    store.updateRuntime(harness.online);
    expect(await store.requestRemoteSyncAndWait()).toBe(true);

    expect(
      harness.submissions.flatMap((request) => request.outgoingUpdates),
    ).toHaveLength(1);
    const merge = onlyMerge(harness);
    expect(outgoingIds(harness.submissions)).toEqual([[merge.updateId]]);
    expect(await queued(harness.execSql, localId)).toEqual([]);
    // A peer that receives only the one update converges on the text.
    expect(await textOf(merge.updateData)).toBe(TYPED);
    expect(store.getSnapshot().text).toBe(TYPED);
  } finally {
    harness.close();
  }
});

test("rows from two store sessions merge after a restart", async () => {
  const harness = await createMergeHarness("queued-merge-restart");
  const localId = "queued-merge-restart";
  try {
    const firstSession = TYPED.slice(0, 8);
    await typeOffline(harness, localId, firstSession);
    const firstRows = await queued(harness.execSql, localId);
    const reopened = await typeOffline(
      harness,
      localId,
      TYPED,
      firstSession.length + 1,
    );
    const backlog = await queued(harness.execSql, localId);
    expect(backlog.length).toBeGreaterThan(firstRows.length);

    reopened.updateRuntime(harness.online);
    expect(await reopened.requestRemoteSyncAndWait()).toBe(true);

    const merge = onlyMerge(harness);
    expect(outgoingIds(harness.submissions)).toEqual([[merge.updateId]]);
    expect(await queued(harness.execSql, localId)).toEqual([]);
    expect(await textOf(merge.updateData)).toBe(TYPED);
  } finally {
    harness.close();
  }
});

test("a lost ack on a merged update recovers through the id conflict", async () => {
  const harness = await createMergeHarness("queued-merge-lost-ack");
  const localId = "queued-merge-lost-ack";
  try {
    const store = await typeOffline(harness, localId, TYPED);
    harness.outcomes.push("commitAndLoseAck", "conflict");

    store.updateRuntime(harness.online);
    await store.requestRemoteSyncAndWait();
    const merge = onlyMerge(harness);
    expect(outgoingIds(harness.submissions)).toEqual([[merge.updateId]]);
    expect(
      (await queued(harness.execSql, localId)).map((row) => row.id),
    ).toEqual([merge.updateId]);

    await store.requestRemoteSyncAndWait();

    // The retry reuses the merged id and conflicts; the server's committed
    // copy carries the same operations, so recovery settles the row.
    expect(onlyMerge(harness)).toBe(merge);
    expect(outgoingIds(harness.submissions)).toEqual([
      [merge.updateId],
      [merge.updateId],
    ]);
    expect(await queued(harness.execSql, localId)).toEqual([]);
    expect(store.getSnapshot().text).toBe(TYPED);
  } finally {
    harness.close();
  }
});

test("a failed merge is logged and the queue is sent unmerged", async () => {
  const harness = await createMergeHarness("queued-merge-failure");
  const localId = "queued-merge-failure";
  try {
    const store = await typeOffline(harness, localId, TYPED);
    const backlog = await queued(harness.execSql, localId);
    harness.control.failMerges = true;

    store.updateRuntime(harness.online);
    expect(await store.requestRemoteSyncAndWait()).toBe(true);

    expect(harness.logs).toContain(
      "Documents: queued update merge skipped: replace failed",
    );
    expect(
      harness.submissions.flatMap((request) =>
        request.outgoingUpdates.map((update) => update.id),
      ),
    ).toEqual(backlog.map((row) => row.id));
    expect(await queued(harness.execSql, localId)).toEqual([]);
  } finally {
    harness.close();
  }
});

/**
 * Another runtime (tab) on the same database and server: its own registry,
 * sync coordinator and Loro peer.
 */
function inAnotherRuntime(
  runtime: DocumentsRuntime,
  domainScope: DocumentsRuntime["state"]["domainScope"],
): DocumentsRuntime {
  return { ...runtime, state: { ...runtime.state, domainScope } };
}

/** Type `suffix` after `base` one keystroke (one queued row) at a time. */
async function typeSuffix(store: DocumentStore, base: string, suffix: string) {
  for (let length = 1; length <= suffix.length; length += 1) {
    await store.setText(`${base}${suffix.slice(0, length)}`);
  }
}

/**
 * Another runtime's write committed to the shared database just before the
 * merging runtime takes the lock: built on the durable history with that
 * runtime's own peer, so the merging runtime's live document lacks it.
 */
async function commitLateForeignWrite(
  execSql: ExecSql,
  localId: string,
  suffix: string,
): Promise<string> {
  const history = await defaultDocumentsPersistence.loadHistoryRestoreState(
    execSql,
    localId,
  );
  if (!history) throw new Error("expected durable history");
  const writer = await createDocument("late-foreign-runtime");
  importSnapshot(writer, base64ToBytes(history.snapshot));
  importUpdates(
    writer,
    history.tailUpdates.map((update) => base64ToBytes(update.updateData)),
  );
  const before = encodeVersionVector(writer);
  const text = writer.getText("text");
  text.insert(text.length, suffix);
  writer.commit();
  const fields = createPendingUpdateFields(exportUpdatesSince(writer, before));
  if (!fields) throw new Error("expected a foreign update");
  const updateId = await enqueueDocumentPendingUpdateWithHistory(
    execSql,
    getDocumentScope(localId),
    fields,
  );
  if (!updateId) throw new Error("expected the foreign row to be queued");
  return updateId;
}

test("a merge leaves another runtime's unproven rows queued and sends them as-is", async () => {
  const harness = await createMergeHarness("queued-merge-two-runtimes");
  const localId = "queued-merge-two-runtimes";
  let lateWrite: Promise<string> | null = null;
  let armLateWrite = false;
  // Runtime A's persistence: when the merge re-lists the queue under the
  // lock, runtime B's late write has just landed.
  const persistenceA: DocumentsPersistence = {
    ...harness.persistence,
    async listPendingUpdates(execSql, id) {
      if (armLateWrite && execSql !== harness.execSql) {
        armLateWrite = false;
        lateWrite = commitLateForeignWrite(execSql, id, " late");
        await lateWrite;
      }
      return harness.persistence.listPendingUpdates(execSql, id);
    },
  };
  try {
    const storeA = createDocumentStore(
      localId,
      harness.online,
      persistenceA,
      null,
      "",
      "note",
    );
    expect(await storeA.ensureInitialized()).toBe(true);
    await storeA.setText("alpha");
    expect(await storeA.requestRemoteSyncAndWait()).toBe(true);
    expect(await queued(harness.execSql, localId)).toEqual([]);
    storeA.updateRuntime(harness.offline);

    // Offline, A queues rows; B (another runtime: own registry and peer)
    // loads them and queues its own. A's next pass reconciles with the
    // durable history, so B's rows written before it are proven too.
    await typeSuffix(storeA, "alpha", " ga");
    const runtimeB = inAnotherRuntime(harness.offline, createDomainScope());
    const storeB = createDocumentStore(
      localId,
      runtimeB,
      harness.persistence,
      null,
      "",
      "note",
    );
    expect(await storeB.ensureInitialized()).toBe(true);
    expect(storeB.getSnapshot().text).toBe("alpha ga");
    await typeSuffix(storeB, "alpha ga", " beta");
    expect(await queued(harness.execSql, localId)).toHaveLength(3 + 5);
    const mergesBefore = harness.merges.length;
    const submissionsBefore = harness.submissions.length;

    armLateWrite = true;
    storeA.updateRuntime(harness.online);
    expect(await storeA.requestRemoteSyncAndWait()).toBe(true);
    if (!lateWrite) throw new Error("expected the late foreign write");
    const lateId = await lateWrite;

    // A merges the eight rows its live document proves (both peers) and
    // sends the late row it cannot prove unchanged, under its own id.
    const [merge, ...extraMerges] = harness.merges.slice(mergesBefore);
    if (!merge) throw new Error("expected one merged row");
    expect(extraMerges).toEqual([]);
    const sent = harness.submissions
      .slice(submissionsBefore)
      .flatMap((request) => request.outgoingUpdates);
    expect(sent.map((update) => update.id)).toEqual([merge.updateId, lateId]);
    expect(
      decodeVersionVector(sent[0]?.partialEndVersionVector).toJSON().size,
    ).toBe(2);
    expect(await queued(harness.execSql, localId)).toEqual([]);

    storeB.updateRuntime(
      inAnotherRuntime(harness.online, runtimeB.state.domainScope),
    );
    expect(await storeB.requestRemoteSyncAndWait()).toBe(true);
    expect(await storeA.requestRemoteSyncAndWait()).toBe(true);

    // Nothing is lost: both runtimes converge on every edit.
    expect(storeA.getSnapshot().text).toBe("alpha ga beta late");
    expect(storeB.getSnapshot().text).toBe("alpha ga beta late");
  } finally {
    harness.close();
  }
});

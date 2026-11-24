import { afterEach, expect, spyOn, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { installFakeWebLocks } from "../../../../../test/helpers/data/fakeWebLocks";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { documentVerdictJudge } from "../../../../data/documents/shared/sync/documentUpdateVerdict";
import { processLoroLifetimes } from "../../../../data/documents/shared/sync/loroLifetime";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { writeLoroWindowInTransaction } from "../../../../data/persistence/documents/records/loroWindowPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../../data/sqlite/sqlitePersistenceRuntime";
import { createExecSql, type ExecSql } from "../../../../data/sqlite/sqlSchema";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { setDocumentText } from "../mutations";
import { createDocumentStoreState } from "../state";
import { assertDocumentStoreCanRotateContentKey } from "./index";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** What the realm's lifetime held when the server saw a request. */
interface SeenRequest {
  readonly maxPageUpdates: number | undefined;
  /** Windows opened before the request, beyond those open before rotation. */
  readonly opened: number;
  /** Windows open at the request, beyond those open before rotation. */
  readonly open: number;
  readonly raw: boolean;
}

/**
 * The database, noting the kind of each window this process writes as its
 * row is written: the row is gone once the page settles.
 */
function watchWindowKinds(execSql: ExecSql) {
  const kinds: string[] = [];
  const watched = createExecSql({
    async exec({ sql, bind, rowMode }) {
      const rows =
        rowMode === "array"
          ? await execSql(sql, bind, { rowMode: "array" })
          : await execSql(sql, bind);
      if (/^insert into "document_loro_windows"/i.test(sql)) {
        const own = await execSql(
          "SELECT kind FROM document_loro_windows WHERE lifetime_id = ?",
          [processLoroLifetimes.id],
        );
        for (const { kind } of own) kinds.push(String(kind));
      }
      return { rows };
    },
  });
  return { kinds, watched };
}

/**
 * A rotation's store against a server that commits what it is sent and
 * serves raw history one update a page when asked to, noting each request.
 */
async function rotationWindowsState(name: string) {
  const database = await createTestExecSql(name);
  cleanups.push(database.close);
  // Holding a lifetime lock, as a tab does, so rotation opens read windows.
  cleanups.push(installFakeWebLocks());
  const opening = spyOn(processLoroLifetimes, "openWindow");
  cleanups.push(() => opening.mockRestore());
  const { kinds, watched: execSql } = watchWindowKinds(database.execSql);
  await sqlDocumentsPersistence.ensureSchema(execSql);
  const fixture = await createRemoteHistoryFixture();
  const localId = `${name}-local`;
  await persistFullHistoryDocument({
    doc: fixture.remoteDocument,
    documentId: fixture.writerProjection.documentId,
    execSql,
    localId,
  });
  const openBefore = processLoroLifetimes.openWindowCount();
  const seen: SeenRequest[] = [];
  const committed: DocumentSyncResponse["updates"] = [];
  const serve = (
    request: DocumentSyncRequest,
    response: DocumentSyncResponse,
  ): DocumentSyncResponse => {
    seen.push({
      maxPageUpdates: request.maxPageUpdates,
      open: processLoroLifetimes.openWindowCount() - openBefore,
      opened: opening.mock.calls.length,
      raw: request.historyMode === "raw",
    });
    const sent = new Set(request.outgoingUpdates.map((update) => update.id));
    committed.push(...response.updates.filter((update) => sent.has(update.id)));
    const updates = [...fixture.response.updates, ...committed];
    if (request.maxPageUpdates !== 1) return { ...response, updates };
    const index = Number(request.pullCursor ?? 0);
    const hasMore = index + 1 < updates.length;
    return {
      ...response,
      pullPage: {
        hasMore,
        nextCursor: hasMore ? String(index + 1) : null,
        throughUpdateId: null,
      },
      updates: updates.slice(index, index + 1),
    };
  };
  const state = createDocumentStoreState(
    localId,
    createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
      responseForRequest: serve,
    }),
    sqlDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    fixture.writerProjection.documentId,
  );
  expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
  return {
    documentId: fixture.writerProjection.documentId,
    execSql,
    kinds,
    localId,
    opening,
    seen,
    state,
  };
}

const windowRows = (execSql: ExecSql) =>
  execSql("SELECT lifetime_id FROM document_loro_windows");

// Rotation reads raw history, already-accepted updates included, so a death
// there must be found like a sync pass's (#3194): each page claims the
// windows dead lifetimes left, asks for one update while their suspects
// stand, and reads in a window of its own that it settles before the next.
// Each is a rotation window, whose death counts toward the rotation, never
// an update.
test("rotation reads each raw page in its own window, isolating as sync does", async () => {
  const { documentId, execSql, kinds, localId, opening, seen, state } =
    await rotationWindowsState("rotation-raw-windows");
  await writeLoroWindowInTransaction(
    getClientSQLitePersistenceRuntime(execSql).db,
    { appKind: "documents", localId },
    {
      counts: false,
      documentId,
      judge: documentVerdictJudge(),
      kind: "read",
      lifetimeId: "dead",
      updateIds: ["first-suspect", "second-suspect"],
      windowId: "dead-window",
    },
    "2026-11-23T00:00:00.000Z",
  );

  expect(await assertDocumentStoreCanRotateContentKey(state)).toBeInstanceOf(
    Uint8Array,
  );

  expect(seen).toEqual([
    { maxPageUpdates: 1, open: 0, opened: 0, raw: true },
    { maxPageUpdates: 1, open: 0, opened: 1, raw: true },
  ]);
  expect(opening).toHaveBeenCalledTimes(2);
  expect(kinds).toEqual(["rotation", "rotation"]);
  expect(await windowRows(execSql)).toEqual([]);
});

// Settling queued edits first, rotation's sync request reads the served
// updates its judge weighs, so it too reads in a window, settled once the
// request is over and before the raw history that follows. It reads new
// updates as any sync does, so its window counts toward them.
test("rotation settlement reads in a window it settles before the raw pull", async () => {
  const { execSql, kinds, opening, seen, state } = await rotationWindowsState(
    "rotation-settlement-window",
  );
  await setDocumentText(state, () => undefined, "Edited before rotation");

  expect(await assertDocumentStoreCanRotateContentKey(state)).toBeInstanceOf(
    Uint8Array,
  );

  expect(seen).toEqual([
    { maxPageUpdates: undefined, open: 0, opened: 0, raw: true },
    { maxPageUpdates: undefined, open: 0, opened: 1, raw: false },
    { maxPageUpdates: undefined, open: 0, opened: 2, raw: true },
  ]);
  expect(opening).toHaveBeenCalledTimes(3);
  expect(kinds).toEqual(["rotation", "read", "rotation"]);
  expect(await windowRows(execSql)).toEqual([]);
});

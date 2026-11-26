import { expect, test } from "bun:test";
import { createDocument, importSnapshot } from "@tearleads/loro";
import {
  FIRST_UPDATE_ID,
  openHistoryVerificationBench,
  readDurableDocumentState,
  servePages,
  verifyHistory,
} from "../../../../../test/helpers/stores/historyVerificationFixtures";
import {
  createMalformedHistoricalBundleFixture,
  createUnreachableEpochFixture,
} from "../../../../../test/helpers/workflows/rawHistoryFixtures";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { DocumentRawHistoryUnavailableError } from "../../../../workflows/documents";
import {
  MAX_EMPTY_HISTORY_PAGES,
  MAX_VERIFIED_HISTORY_UPDATES,
} from "../../../../workflows/documents/history/documentHistoryRawPull";

type Bench = Awaited<ReturnType<typeof openHistoryVerificationBench>>;

/** The fixture's remote history stored as this device's own. */
async function persistRemoteHistory(bench: Bench, localId: string) {
  await persistFullHistoryDocument({
    doc: bench.fixture.remoteDocument,
    documentId: bench.fixture.writerProjection.documentId,
    execSql: bench.execSql,
    localId,
  });
}

test("an unreachable epoch key is reported with its epoch, and nothing changes", async () => {
  const bench = await openHistoryVerificationBench("history-verify-epoch");
  const { execSql, fixture } = bench;
  try {
    const localId = "history-verify-epoch-local";
    const currentFixture = await createUnreachableEpochFixture({
      execSql,
      fixture,
      localId,
    });
    const syncCalls = { count: 0 };
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture: currentFixture,
      syncCalls,
    });
    const before = await readDurableDocumentState(execSql, localId);

    const result = await verifyHistory(runtime, localId);

    expect(result).toMatchObject({
      contentKeyEpoch:
        fixture.writerProjection.contentKeyBundle.contentKeyEpoch,
      reason: "epoch_key_unreachable",
      status: "unavailable",
    });
    if (result.status !== "unavailable") return;
    if (result.reason !== "epoch_key_unreachable") return;
    expect(result.error).toBeInstanceOf(DocumentRawHistoryUnavailableError);
    expect(result.error.contentKeyEpoch).toBe(result.contentKeyEpoch);
    expect(syncCalls.count).toBe(1);
    expect(await readDurableDocumentState(execSql, localId)).toEqual(before);
    expect(before.windows).toEqual([]);
  } finally {
    bench.close();
  }
}, 10_000);

// A bundle that is present but malformed is the server's response failing
// an integrity check, never a key this device merely cannot reach. Rotation
// records a sync failure for it; a viewer records nothing.
test("a malformed historical bundle is rejected, not reported unavailable", async () => {
  const bench = await openHistoryVerificationBench("history-verify-malformed");
  const { execSql, fixture } = bench;
  try {
    const currentFixture =
      await createMalformedHistoricalBundleFixture(fixture);
    const localId = "history-verify-malformed-local";
    const behind = await createDocument("history-verify-malformed-behind");
    importSnapshot(behind, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behind,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture: currentFixture,
    });
    const before = await readDurableDocumentState(execSql, localId);

    expect(await verifyHistory(runtime, localId)).toEqual({
      reason: "rejected",
      status: "unavailable",
    });
    const after = await readDurableDocumentState(execSql, localId);
    expect(after).toEqual(before);
    expect(after.terminalFailures).toBe(false);
  } finally {
    bench.close();
  }
}, 10_000);

test("a history past the cap is refused from its first page", async () => {
  const bench = await openHistoryVerificationBench("history-verify-large");
  const { execSql, fixture } = bench;
  try {
    const localId = "history-verify-large-local";
    await persistRemoteHistory(bench, localId);
    const [first, second] = fixture.response.updates;
    if (!first || !second) throw new Error("Expected two ordinary updates");
    const served = servePages(
      [[first], [second]],
      MAX_VERIFIED_HISTORY_UPDATES + 1,
    );
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      responseForRequest: served.responseForRequest,
    });
    const before = await readDurableDocumentState(execSql, localId);

    expect(await verifyHistory(runtime, localId)).toEqual({
      reason: "too_large",
      status: "unavailable",
    });
    expect(served.requests).toHaveLength(1);
    expect(await readDurableDocumentState(execSql, localId)).toEqual(before);
  } finally {
    bench.close();
  }
}, 10_000);

test("offline, unsynced, and isolating documents are not read", async () => {
  const bench = await openHistoryVerificationBench("history-verify-unread");
  const { execSql, fixture } = bench;
  try {
    const localId = "history-verify-unread-local";
    await persistRemoteHistory(bench, localId);
    const syncCalls = { count: 0 };
    const runtimeWhen = (online: boolean) =>
      createRotationRecoveryRuntime({ execSql, fixture, online, syncCalls });

    expect(await verifyHistory(runtimeWhen(false), localId)).toEqual({
      reason: "offline",
      status: "unavailable",
    });
    // No record, so nothing was ever uploaded.
    expect(await verifyHistory(runtimeWhen(true), "never-synced")).toEqual({
      reason: "not_synced",
      status: "unavailable",
    });
    // A death left this scope reading suspects one a page, alone.
    await execSql(
      `INSERT INTO document_loro_isolation (app_kind, local_id, document_id,
         suspects) VALUES ('documents', ?, ?, ?)`,
      [
        localId,
        fixture.writerProjection.documentId,
        JSON.stringify([FIRST_UPDATE_ID]),
      ],
    );
    const before = await readDurableDocumentState(execSql, localId);
    expect(await verifyHistory(runtimeWhen(true), localId)).toEqual({
      reason: "unsettled",
      status: "unavailable",
    });
    expect(await readDurableDocumentState(execSql, localId)).toEqual(before);
    expect(syncCalls.count).toBe(0);
  } finally {
    bench.close();
  }
}, 10_000);

test("a server that holds no update of the document has nothing to verify", async () => {
  const bench = await openHistoryVerificationBench("history-verify-empty");
  const { execSql, fixture } = bench;
  try {
    const localId = "history-verify-empty-local";
    await persistRemoteHistory(bench, localId);
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      responseForRequest: servePages([[]]).responseForRequest,
    });
    const before = await readDurableDocumentState(execSql, localId);

    expect(await verifyHistory(runtime, localId)).toEqual({
      reason: "not_synced",
      status: "unavailable",
    });
    expect(await readDurableDocumentState(execSql, localId)).toEqual(before);
  } finally {
    bench.close();
  }
}, 10_000);

test("an abort between pages interrupts the verification", async () => {
  const bench = await openHistoryVerificationBench("history-verify-abort");
  const { execSql, fixture } = bench;
  try {
    const localId = "history-verify-abort-local";
    await persistRemoteHistory(bench, localId);
    const [first, second] = fixture.response.updates;
    if (!first || !second) throw new Error("Expected two ordinary updates");
    const served = servePages([[first], [second]]);
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      responseForRequest: served.responseForRequest,
    });
    const abort = new AbortController();
    const before = await readDurableDocumentState(execSql, localId);

    const result = await verifyHistory(runtime, localId, {
      // The first page was read and judged: stop before the second.
      onProgress: () => abort.abort(),
      signal: abort.signal,
    });

    expect(result).toEqual({ reason: "interrupted", status: "unavailable" });
    expect(served.requests).toHaveLength(1);
    expect(await readDurableDocumentState(execSql, localId)).toEqual(before);
    expect(before.windows).toEqual([]);
  } finally {
    bench.close();
  }
}, 10_000);

test("a cursor the server repeats is rejected", async () => {
  const bench = await openHistoryVerificationBench("history-verify-cycle");
  const { execSql, fixture } = bench;
  try {
    const localId = "history-verify-cycle-local";
    await persistRemoteHistory(bench, localId);
    const requested: Array<string | undefined> = [];
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      responseForRequest: (request, response) => {
        requested.push(request.pullCursor);
        return {
          ...response,
          pullPage: {
            hasMore: true,
            nextCursor:
              request.pullCursor === "cycle-a" ? "cycle-b" : "cycle-a",
            throughUpdateCount: 0,
            throughUpdateId: null,
          },
          updates: [],
        };
      },
    });

    expect(await verifyHistory(runtime, localId)).toEqual({
      reason: "rejected",
      status: "unavailable",
    });
    expect(requested).toEqual([undefined, "cycle-a", "cycle-b"]);
  } finally {
    bench.close();
  }
}, 10_000);

test("a server that keeps promising more while serving nothing is rejected", async () => {
  const bench = await openHistoryVerificationBench("history-verify-empty");
  const { execSql, fixture } = bench;
  try {
    const localId = "history-verify-empty-local";
    await persistRemoteHistory(bench, localId);
    let pages = 0;
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      responseForRequest: (_request, response) => {
        pages += 1;
        return {
          ...response,
          pullPage: {
            hasMore: true,
            nextCursor: `empty-${pages}`,
            throughUpdateCount: 0,
            throughUpdateId: null,
          },
          updates: [],
        };
      },
    });

    expect(await verifyHistory(runtime, localId)).toEqual({
      reason: "rejected",
      status: "unavailable",
    });
    // One empty page may be honest; a run of them is not.
    expect(pages).toBe(MAX_EMPTY_HISTORY_PAGES + 1);
  } finally {
    bench.close();
  }
}, 10_000);

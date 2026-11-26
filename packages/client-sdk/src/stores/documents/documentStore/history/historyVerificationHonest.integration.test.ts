import { expect, spyOn, test } from "bun:test";
import {
  createDocument,
  exportFullHistorySnapshot,
  importSnapshot,
} from "@tearleads/loro";
import {
  FIRST_UPDATE_ID,
  openHistoryVerificationBench,
  readDurableDocumentState,
  recordVoidRow,
  SECOND_UPDATE_ID,
  servePages,
  verifyHistory,
} from "../../../../../test/helpers/stores/historyVerificationFixtures";
import { createRotationBaselineUpdate } from "../../../../../test/helpers/workflows/rawHistoryFixtures";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { processLoroLifetimes } from "../../../../data/documents/shared/sync/loroLifetime";

const BASELINE_ID = "550e8400-e29b-41d4-a716-446655440449";

/** A document of peer `seed` that holds `source`'s history and one more edit. */
async function editedCopy(
  seed: string,
  source: Parameters<typeof exportFullHistorySnapshot>[0],
  text: string,
) {
  const copy = await createDocument(seed);
  importSnapshot(copy, exportFullHistorySnapshot(source));
  copy.getText("text").update(text);
  copy.commit();
  return copy;
}

test("an honest history read over several pages is verified, with who uploaded what", async () => {
  const bench = await openHistoryVerificationBench("history-verify-honest");
  const opening = spyOn(processLoroLifetimes, "openWindow");
  const { execSql, fixture } = bench;
  try {
    // A rotation baseline whose writer had made an edit no ordinary update
    // carries: those operations reach readers only through the baseline.
    const rotated = await editedCopy(
      "history-verify-rotator",
      fixture.remoteDocument,
      "survives key rotation, and a baseline",
    );
    const baseline = await createRotationBaselineUpdate(
      fixture,
      BASELINE_ID,
      rotated,
    );
    const [first, second] = fixture.response.updates;
    if (!first || !second) throw new Error("Expected two ordinary updates");
    const localId = "history-verify-honest-local";
    const documentId = fixture.writerProjection.documentId;
    await persistFullHistoryDocument({
      doc: rotated,
      documentId,
      execSql,
      localId,
    });
    // An attempt an earlier death counted toward an update this history
    // holds: verification reads the update and must leave the count alone.
    await recordVoidRow(execSql, {
      attempts: 1,
      documentId,
      localId,
      stage: "loro_runtime",
      updateId: SECOND_UPDATE_ID,
    });
    const served = servePages([
      [first],
      [second, ...baseline.response.updates],
    ]);
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      responseForRequest: served.responseForRequest,
    });
    const before = await readDurableDocumentState(execSql, localId);
    const openBefore = processLoroLifetimes.openWindowCount();
    const progress: unknown[] = [];
    opening.mockClear();

    const result = await verifyHistory(runtime, localId, {
      onProgress: (step) => progress.push(step),
    });

    expect(result).toMatchObject({
      serverAhead: false,
      status: "verified",
      voidUpdateCount: 0,
    });
    if (result.status !== "verified") return;
    const signer = {
      writerKeyFingerprint: fixture.author.signerKeyFingerprint,
      writerUserId: fixture.author.signerUserId,
    };
    const writer = fixture.remoteDocument;
    const rangeOf = (updateId: string) =>
      result.ranges.find((range) => range.updateId === updateId);
    const firstRange = rangeOf(FIRST_UPDATE_ID);
    expect(result.ranges).toHaveLength(3);
    // The two ordinary updates carried the writer's operations between them.
    expect(firstRange).toMatchObject({
      ...signer,
      authorityKind: "direct",
      peerId: writer.peerIdStr,
      startCounter: 0,
    });
    expect(rangeOf(SECOND_UPDATE_ID)).toMatchObject({
      ...signer,
      authorityKind: "direct",
      endCounter: writer.oplogVersion().get(writer.peerIdStr),
      peerId: writer.peerIdStr,
      startCounter: firstRange?.endCounter,
    });
    // The baseline carried them again, and is credited only with its own.
    expect(rangeOf(BASELINE_ID)).toMatchObject({
      ...signer,
      authorityKind: "baseline",
      endCounter: rotated.oplogVersion().get(rotated.peerIdStr),
      peerId: rotated.peerIdStr,
      startCounter: 0,
    });
    expect(progress).toEqual([
      { updatesRead: 1, updatesTotal: 3 },
      { updatesRead: 3, updatesTotal: 3 },
    ]);
    expect(served.requests.map((request) => request.pullCursor)).toEqual([
      undefined,
      "page-1",
    ]);
    // One read window a page, each settled before the next page is asked for.
    expect(opening).toHaveBeenCalledTimes(2);
    expect(processLoroLifetimes.openWindowCount()).toBe(openBefore);
    expect(await readDurableDocumentState(execSql, localId)).toEqual(before);
    expect(before.windows).toEqual([]);
  } finally {
    opening.mockRestore();
    bench.close();
  }
}, 10_000);

test("an unsent edit leaves the history verified, with no range over it", async () => {
  const bench = await openHistoryVerificationBench("history-verify-unsent");
  const { execSql, fixture } = bench;
  try {
    const device = await editedCopy(
      "history-verify-device",
      fixture.remoteDocument,
      "survives key rotation, and an unsent edit",
    );
    const localId = "history-verify-unsent-local";
    await persistFullHistoryDocument({
      doc: device,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const served = servePages([fixture.response.updates]);
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      responseForRequest: served.responseForRequest,
    });
    const before = await readDurableDocumentState(execSql, localId);

    const result = await verifyHistory(runtime, localId);

    expect(result).toMatchObject({ serverAhead: false, status: "verified" });
    if (result.status !== "verified") return;
    expect(
      result.localVersion.some((entry) => entry.peerId === device.peerIdStr),
    ).toBe(true);
    expect(result.ranges.map((range) => range.peerId)).toEqual([
      fixture.remoteDocument.peerIdStr,
      fixture.remoteDocument.peerIdStr,
    ]);
    expect(await readDurableDocumentState(execSql, localId)).toEqual(before);
  } finally {
    bench.close();
  }
}, 10_000);

test("updates the device has not pulled leave the history verified and the server ahead", async () => {
  const bench = await openHistoryVerificationBench("history-verify-behind");
  const { execSql, fixture } = bench;
  try {
    const behind = await createDocument("history-verify-behind-reader");
    importSnapshot(behind, fixture.behindSnapshot);
    const localId = "history-verify-behind-local";
    await persistFullHistoryDocument({
      doc: behind,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      responseForRequest: servePages([fixture.response.updates])
        .responseForRequest,
    });

    expect(await verifyHistory(runtime, localId)).toMatchObject({
      serverAhead: true,
      status: "verified",
    });
  } finally {
    bench.close();
  }
}, 10_000);

import { expect, test } from "bun:test";
import {
  FIRST_UPDATE_ID,
  finalText,
  openHistoryVerificationBench,
  readDurableDocumentState,
  recordVoidRow,
  SECOND_UPDATE_ID,
  servePages,
  verifyHistory,
} from "../../../../../test/helpers/stores/historyVerificationFixtures";
import { createForgedRotationBaseline } from "../../../../../test/helpers/workflows/rawHistoryFixtures";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";

const FORGED_ID = "550e8400-e29b-41d4-a716-446655440448";

/**
 * A device whose whole history came from a forged rotation baseline: the
 * same operation ids as the genuine updates, at the same version, with other
 * content. The server still retains the genuine updates and serves them
 * first, so a reader of raw history accepts them and voids the baseline.
 */
async function bootstrapFromForgedBaseline(name: string) {
  const bench = await openHistoryVerificationBench(name);
  const { execSql, fixture } = bench;
  const forged = await createForgedRotationBaseline(fixture, FORGED_ID);
  const localId = `${name}-local`;
  const documentId = fixture.writerProjection.documentId;
  await persistFullHistoryDocument({
    doc: forged.document,
    documentId,
    execSql,
    localId,
  });
  const served = servePages([
    [...fixture.response.updates, ...forged.response.updates],
  ]);
  const runtime = createRotationRecoveryRuntime({
    execSql,
    fixture,
    responseForRequest: served.responseForRequest,
  });
  return { ...bench, documentId, localId, runtime, served };
}

test("a device bootstrapped from a forged baseline learns its history differs", async () => {
  const device = await bootstrapFromForgedBaseline("history-verify-forged");
  const { execSql, localId } = device;
  try {
    const before = await readDurableDocumentState(execSql, localId);

    const result = await verifyHistory(device.runtime, localId);

    expect(result.status).toBe("mismatch");
    if (result.status !== "mismatch") return;
    try {
      // The signed replay is the genuine history, not the device's own.
      expect(finalText(result.signed)).toBe("survives key rotation");
      expect(result.voidUpdateCount).toBe(1);
      expect(result.serverAhead).toBe(false);
      expect(result.ranges.map((range) => range.updateId)).toEqual([
        FIRST_UPDATE_ID,
        SECOND_UPDATE_ID,
      ]);
    } finally {
      result.signed.close();
    }
    expect(device.served.requests).toHaveLength(1);
    expect(await readDurableDocumentState(execSql, localId)).toEqual(before);
    expect(before.windows).toEqual([]);
  } finally {
    device.close();
  }
}, 10_000);

// That device's sync passes judged the genuine updates against the forged
// history it held, and voided them as reusing held ids. A verifier that kept
// those voids would leave the genuine updates out of its rebuild, accept the
// forged baseline into the gap, and call the forgery verified.
test("recorded import voids of the genuine updates do not hide the forgery", async () => {
  const device = await bootstrapFromForgedBaseline("history-verify-voided");
  const { documentId, execSql, localId } = device;
  try {
    for (const updateId of [FIRST_UPDATE_ID, SECOND_UPDATE_ID]) {
      await recordVoidRow(execSql, {
        documentId,
        localId,
        stage: "loro_import",
        updateId,
      });
    }
    const before = await readDurableDocumentState(execSql, localId);
    expect(before.voids).toHaveLength(2);

    const result = await verifyHistory(device.runtime, localId);

    expect(result.status).toBe("mismatch");
    if (result.status !== "mismatch") return;
    try {
      expect(finalText(result.signed)).toBe("survives key rotation");
      expect(result.voidUpdateCount).toBe(1);
    } finally {
      result.signed.close();
    }
    // The device's own void rows stand: the verifier only read them.
    expect(await readDurableDocumentState(execSql, localId)).toEqual(before);
  } finally {
    device.close();
  }
}, 10_000);

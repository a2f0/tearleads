// A heal whose rotation baseline does not fit its request uploads every
// segment but the final one to a stage, and the sync that rotates carries
// the final segment and names the stage.
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  historySegmentsImportInOrder,
  mergeVersionVectors,
  versionVectorsEqual,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  MAX_DOCUMENT_BASELINE_SEGMENTS,
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
} from "@tearleads/validators/util";
import {
  createLongHistoryDocument,
  createStagedHealHarness,
} from "../../../../test/helpers/workflows/stagedBaselineHeal";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { DOCUMENT_SYNC_TRACE_PATTERN } from "./syncTrace";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql(
    "document-sync-staged-heal",
  ));
  await ensureDocumentTables(execSql);
});

afterEach(() => closeExecSql());

type Harness = Awaited<ReturnType<typeof createStagedHealHarness>>;
type HistoryDocument = Awaited<ReturnType<typeof createDocument>>;

/** The one group the server committed reaches exactly `document`'s version. */
function expectCommittedHistory(harness: Harness, document: HistoryDocument) {
  expect(harness.server.committed).toHaveLength(1);
  const [group = []] = harness.server.committed;
  expect(historySegmentsImportInOrder(group)).toBe(true);
  expect(group.map((segment) => segment.baselineSegmentIndex)).toEqual(
    group.map((_, index) => index),
  );
  expect(
    versionVectorsEqual(
      mergeVersionVectors(
        group.map((segment) => segment.partialEndVersionVector),
      ),
      encodeVersionVector(document),
    ),
  ).toBe(true);
  return group;
}

test("a history of more segments than a request carries heals through a stage", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("staged-heal");

  const synced = await harness.heal(document, execSql);

  if (!synced) throw new Error("Expected the staged heal to complete");
  expect(synced.acceptedRecoveryBaseline).toBe(true);
  const group = expectCommittedHistory(harness, document);
  expect(group.length).toBeGreaterThan(MAX_DOCUMENT_BASELINE_SEGMENTS);
  // One open, then every segment but the final one, strictly in order.
  expect(harness.server.calls).toEqual([
    "open",
    ...group.slice(0, -1).map((_, index) => `stage:${index}`),
  ]);
  // The one request that rotates carries the final segment first, names the
  // stage, and sends the queue behind it.
  expect(harness.requests).toHaveLength(1);
  const [request] = harness.requests;
  const [final, queued, ...rest] = request?.outgoingUpdates ?? [];
  expect(rest).toEqual([]);
  expect(request?.baselineStageId).toBe(final?.baselineId);
  expect(final?.baselineSegmentCount).toBe(group.length);
  expect(queued?.baselineId).toBeUndefined();
  // Only the final segment seals: no staged one signs a count or digest.
  expect(
    group.slice(0, -1).filter((segment) => segment.baselineSegmentCount),
  ).toEqual([]);
  expect(harness.terminalFailures).toEqual([]);
  // Progress is reported in the trace's closed vocabulary.
  const stageLines = harness.traceLines.filter((line) =>
    line.includes("baseline stage"),
  );
  expect(stageLines.length).toBeGreaterThan(4);
  expect(stageLines[0]).toBe(
    `document sync baseline stage document=${harness.documentId} status=planning segments=0`,
  );
  expect(stageLines.at(-1)).toBe(
    `document sync baseline stage document=${harness.documentId} status=committing segments=${group.length - 1}`,
  );
  for (const line of harness.traceLines) {
    expect(line).toMatch(DOCUMENT_SYNC_TRACE_PATTERN);
  }
});

test("a history that fits one request heals in one request and opens no stage", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("inline-heal", 20);

  const synced = await harness.heal(document, execSql);

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  expect(harness.server.calls).toEqual([]);
  expect(harness.requests).toHaveLength(1);
  const [request] = harness.requests;
  expect(request?.baselineStageId).toBeUndefined();
  const segments = (request?.outgoingUpdates ?? []).filter(
    (update) => update.baselineId !== undefined,
  );
  expect(segments.length).toBeGreaterThan(1);
  expect(segments.length).toBeLessThanOrEqual(MAX_DOCUMENT_BASELINE_SEGMENTS);
  expect(segments.at(-1)?.baselineSegmentCount).toBe(segments.length);
});

// The defect of #3238: a history larger than one request could not rotate,
// and its heal ended in `document_sync_request_too_large`.
test("a history over 16 MiB heals through a stage at the default sizes", async () => {
  const harness = await createStagedHealHarness();
  const document = await createDocument("large-staged-heal");
  const bytes = new Uint8Array(13 * 1024 * 1024);
  for (let offset = 0; offset < bytes.length; offset += 65_536) {
    crypto.getRandomValues(bytes.subarray(offset, offset + 65_536));
  }
  document.getText("text").insert(0, bytes.toBase64());
  document.commit();

  const synced = await harness.heal(document, execSql, {});

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  const group = expectCommittedHistory(harness, document);
  expect(group.length).toBeGreaterThan(2);
  expect(harness.server.stagedCharacters).toBeGreaterThan(
    MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  );
  // The final segment is cut small: it shares the rotating request.
  expect(group.at(-1)?.encryptedData.length).toBeLessThan(2 * 1024 * 1024);
  expect(harness.requests).toHaveLength(1);
  expect(harness.terminalFailures).toEqual([]);
}, 120_000);

test("a stage request refused for access stops the pass and deletes the stage", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("refused-stage");
  harness.server.refuseNext("stage:3", {
    message: "PUT segment: 403 Forbidden",
    status: 403,
  });

  expect(await harness.heal(document, execSql)).toBeNull();

  // Nothing was retried or committed. The writer gave the upload up, so it
  // deleted the stage: one left to expire would hold one of the user's
  // open stages for an hour.
  expect(harness.server.calls).toEqual([
    "open",
    "stage:0",
    "stage:1",
    "stage:2",
    "stage:3",
    "abandon",
  ]);
  expect(harness.requests).toEqual([]);
  expect(harness.server.stage(harness.documentId)).toBeNull();
  expect(harness.terminalFailures).toMatchObject([
    { code: undefined, message: "PUT segment: 403 Forbidden", status: 403 },
  ]);
  expect(harness.abandonedReasons).toEqual([
    "the rotation baseline could not be staged",
  ]);
});

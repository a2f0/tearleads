// What a heal does when its stage cannot open because the user holds four
// already: the longest idle stage nobody is filling is abandoned and the
// open is sent once more, and a stage that is being filled is never touched.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE } from "@tearleads/validators/response";
import { DOCUMENT_BASELINE_STAGE_IDLE_SECONDS } from "@tearleads/validators/util";
import {
  createLongHistoryDocument,
  createStagedHealHarness,
} from "../../../../test/helpers/workflows/stagedBaselineHeal";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { ORPHANED_STAGE_IDLE_MS } from "../baselineStage/stagedBaselineOrphans";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql(
    "document-sync-staged-orphans",
  ));
  await ensureDocumentTables(execSql);
});

afterEach(() => closeExecSql());

const MINUTE_MS = 60 * 1000;

/** An open stage on another document, last touched `idleMs` ago. */
function openStage(name: string, idleMs: number) {
  const touchedAt = Date.now() - idleMs;
  return {
    baselineId: `baseline-${name}`,
    documentId: `document-${name}`,
    expiresAt: new Date(
      touchedAt + DOCUMENT_BASELINE_STAGE_IDLE_SECONDS * 1000,
    ).toISOString(),
  };
}

const opens = (calls: readonly string[]) =>
  calls.filter((call) => call === "open");

// A process that restarts forgets its uploads, and each stage it left holds
// one of the user's four places for an hour. Without this rule the fifth
// upload was refused until they expired.
test("the longest idle stage a restarted process left is abandoned and the open is sent again", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("orphans-cleared");
  const kept = [
    openStage("a", ORPHANED_STAGE_IDLE_MS),
    openStage("b", 20 * MINUTE_MS),
    openStage("c", 45 * MINUTE_MS),
  ];
  harness.server.elsewhere.push(...kept, openStage("d", 59 * MINUTE_MS));

  const synced = await harness.heal(document, execSql);

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  // One place is all the open needs: the other orphans are left.
  expect(harness.server.calls.slice(0, 4)).toEqual([
    "open",
    "abandon",
    "open",
    "stage:0",
  ]);
  expect(harness.server.elsewhere).toEqual(kept);
  expect(harness.terminalFailures).toEqual([]);
});

// Two devices of one user see each other's stages. A stage touched within
// the idle period is an upload under way somewhere, and this device leaves
// it: the limit is then the user's to hear of.
test("a stage another device is filling is left alone, and the limit is reported", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("orphans-fresh");
  const fresh = [
    openStage("a", 0),
    openStage("b", MINUTE_MS),
    openStage("c", 5 * MINUTE_MS),
    openStage("d", ORPHANED_STAGE_IDLE_MS - MINUTE_MS),
  ];
  harness.server.elsewhere.push(...fresh);

  expect(await harness.heal(document, execSql)).toBeNull();

  expect(harness.server.calls).toEqual(["open"]);
  expect(harness.server.elsewhere).toEqual(fresh);
  expect(harness.requests).toEqual([]);
  expect(harness.terminalFailures).toMatchObject([
    { code: STAGE.limitReached, status: 409 },
  ]);
});

test("a fresh stage is never the one that goes", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("orphans-mixed");
  const fresh = [
    openStage("a", MINUTE_MS),
    openStage("b", 2 * MINUTE_MS),
    openStage("c", 3 * MINUTE_MS),
  ];
  harness.server.elsewhere.push(...fresh, openStage("left", 30 * MINUTE_MS));

  const synced = await harness.heal(document, execSql);

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  expect(harness.server.calls.slice(0, 4)).toEqual([
    "open",
    "abandon",
    "open",
    "stage:0",
  ]);
  expect(harness.server.elsewhere).toEqual(fresh);
});

// The open is sent again once, never in a loop: a place another upload took
// meanwhile, or an abandon the API did not take, leaves the limit standing.
test("a limit that still stands after an orphan is gone is reported", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("orphans-raced");
  const orphans = ["a", "b", "c", "d"].map((name) =>
    openStage(name, 30 * MINUTE_MS),
  );
  harness.server.elsewhere.push(...orphans);
  // Another device takes the freed place before this one's second open.
  harness.server.beforeNext("open", () => {
    harness.server.beforeNext("open", () => {
      harness.server.elsewhere.push(openStage("e", 0));
    });
  });

  expect(await harness.heal(document, execSql)).toBeNull();

  expect(opens(harness.server.calls)).toHaveLength(2);
  expect(harness.server.calls).not.toContain("stage:0");
  expect(harness.terminalFailures).toMatchObject([
    { code: STAGE.limitReached, status: 409 },
  ]);
});

test("an abandon the API fails frees no place, so the open is not sent again", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("orphans-outage");
  harness.server.elsewhere.push(
    ...["a", "b", "c", "d"].map((name) => openStage(name, 30 * MINUTE_MS)),
  );
  for (let index = 0; index < 4; index += 1) {
    harness.server.refuseNext("abandon", { status: 503 });
  }

  expect(await harness.heal(document, execSql)).toBeNull();

  expect(opens(harness.server.calls)).toHaveLength(1);
  expect(harness.server.elsewhere).toHaveLength(4);
  expect(harness.terminalFailures).toMatchObject([
    { code: STAGE.limitReached, status: 409 },
  ]);
});

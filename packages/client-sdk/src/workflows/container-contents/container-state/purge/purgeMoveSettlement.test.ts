import { expect, test } from "bun:test";
import { withTestExecSql } from "../../../../../test/helpers/withTestExecSql";
import {
  CONTAINER_MOVE_INTENT_TYPE,
  type ContainerMoveIntentRecord,
} from "../../../../data/persistence/container-contents/containerContentsPersistenceTypes";
import { sqlDocumentMoveIntentPersistence } from "../../../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import type { ContainerState } from "../../remoteHydration";
import {
  type PurgeMoveSyncLane,
  settlePurgeScopeMoves,
} from "./purgeMoveSettlement";
import type { PurgeMoveSettlement } from "./purgeProgress";

type LaneRun = NonNullable<ReturnType<PurgeMoveSyncLane["read"]>>;

const containersById = new Map<string, ContainerState>(
  (
    [
      ["trash", null],
      ["folder", "trash"],
      ["child", "folder"],
      ["elsewhere", null],
    ] as const
  ).map(([id, parentId]) => [
    id,
    { container: { id, parentId } } as unknown as ContainerState,
  ]),
);

function moveIntent(
  containerId: string,
  lastAttemptedAt: string | null = null,
): ContainerMoveIntentRecord {
  return {
    containerId,
    createdAt: "2026-10-19T00:00:00.000Z",
    id: `move-${containerId}`,
    intentType: CONTAINER_MOVE_INTENT_TYPE,
    lastAttemptedAt,
    lastError: null,
    parentContainerId: "trash",
    previousParentContainerId: "elsewhere",
    syncStatus: "pending",
    updatedAt: "2026-10-19T00:00:00.000Z",
  };
}

function idleLane(runCount: number): LaneRun {
  return { lastStartedAt: null, requested: false, runCount, running: false };
}

async function settle(input: {
  execSql: ExecSql;
  lane: Partial<PurgeMoveSyncLane> & { read: PurgeMoveSyncLane["read"] };
  moves: () =>
    | ContainerMoveIntentRecord[]
    | Promise<ContainerMoveIntentRecord[]>;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const settlements: PurgeMoveSettlement[] = [];
  const reports: string[] = [];
  let requests = 0;
  const result = await settlePurgeScopeMoves({
    containersById,
    execSql: input.execSql,
    lane: {
      read: input.lane.read,
      request: () => {
        requests += 1;
        input.lane.request?.();
      },
    },
    onMoveSettlement: (settlement) => settlements.push(settlement),
    persistence: { listUnsyncedMoveIntents: async () => input.moves() },
    report: (_message, error) => reports.push(error.message),
    rootContainerId: "folder",
    signal: input.signal,
    stillCurrent: () => true,
    timing: { pollMs: 1, timeoutMs: input.timeoutMs ?? 5_000 },
  });
  return { reports, requests, result, settlements };
}

test("a purge with nothing queued in its scope does not wait", async () => {
  await withTestExecSql("purge-move-settlement-none", async (execSql) => {
    const outcome = await settle({
      execSql,
      lane: { read: () => idleLane(0) },
      moves: () => [moveIntent("elsewhere")],
    });
    expect(outcome).toEqual({
      reports: [],
      requests: 0,
      result: "settled",
      settlements: [],
    });
  });
});

test("a queued subtree move is replayed and awaited before the purge", async () => {
  await withTestExecSql("purge-move-settlement-wait", async (execSql) => {
    let queued = true;
    let reads = 0;
    const outcome = await settle({
      execSql,
      lane: { read: () => idleLane(0) },
      moves: () => {
        reads += 1;
        // The replay lands between two polls.
        if (reads === 3) queued = false;
        return queued ? [moveIntent("child")] : [];
      },
    });
    expect(outcome).toEqual({
      reports: [],
      requests: 1,
      result: "settled",
      settlements: ["waiting"],
    });
  });
});

test("a requested pass that leaves the move queued ends the wait", async () => {
  await withTestExecSql("purge-move-settlement-idle", async (execSql) => {
    let run = idleLane(4);
    const outcome = await settle({
      execSql,
      lane: {
        read: () => run,
        request: () => {
          run = {
            lastStartedAt: new Date().toISOString(),
            requested: false,
            runCount: 5,
            running: false,
          };
        },
      },
      moves: () => [moveIntent("folder")],
    });
    expect(outcome).toEqual({
      reports: ["Purge scope move stayed queued"],
      requests: 1,
      result: "unsettled",
      settlements: ["waiting", "unsettled"],
    });
  });
});

test("only a failure recorded by a requested pass ends the wait", async () => {
  await withTestExecSql("purge-move-settlement-failed", async (execSql) => {
    const earlier = new Date(Date.now() - 1_000).toISOString();
    let run: LaneRun = {
      lastStartedAt: earlier,
      requested: false,
      runCount: 7,
      running: true,
    };
    let attempt: string | null = null;
    let reads = 0;
    const outcome = await settle({
      execSql,
      lane: {
        read: () => run,
        request: () => {
          run = { ...run, requested: true };
        },
      },
      moves: () => {
        reads += 1;
        if (reads === 2) {
          // The pass already running when the purge asked records a failure.
          attempt = new Date().toISOString();
        } else if (reads === 4) {
          run = {
            lastStartedAt: new Date(Date.now() + 500).toISOString(),
            requested: false,
            runCount: 8,
            running: true,
          };
        } else if (reads === 6) {
          attempt = new Date(Date.now() + 1_000).toISOString();
        }
        return [moveIntent("folder", attempt)];
      },
    });
    expect(reads).toBe(6);
    expect(outcome.result).toBe("unsettled");
    expect(outcome.reports).toEqual(["Purge scope move failed to sync"]);
  });
});

async function saveQueuedDocument(
  execSql: ExecSql,
  containerId: string,
): Promise<{ documentId: string; localId: string }> {
  await sqlDocumentsPersistence.ensureSchema(execSql);
  const localId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  await sqlDocumentsPersistence.saveDocument(execSql, {
    accessEpoch: 1,
    containerId,
    documentId,
    documentKind: "note",
    id: localId,
    snapshotEndVersion: "",
    text: "",
    title: "Queued",
  });
  await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
    documentId,
    localId,
    sourceContainerId: "elsewhere",
    targetContainerId: containerId,
  });
  return { documentId, localId };
}

test("a parked document placement in scope ends the purge without waiting", async () => {
  await withTestExecSql("purge-move-settlement-parked", async (execSql) => {
    const { documentId } = await saveQueuedDocument(execSql, "child");
    await sqlDocumentMoveIntentPersistence.recordMoveIntentError(execSql, {
      denied: true,
      documentId,
      message: "denied",
    });
    const outcome = await settle({
      execSql,
      lane: { read: () => idleLane(0) },
      moves: () => [],
    });
    expect(outcome).toEqual({
      reports: ["Purge scope holds a parked move"],
      requests: 0,
      result: "unsettled",
      settlements: ["unsettled"],
    });
  });
});

test("document placements outside the scope do not hold the purge", async () => {
  await withTestExecSql("purge-move-settlement-outside", async (execSql) => {
    await saveQueuedDocument(execSql, "elsewhere");
    const outcome = await settle({
      execSql,
      lane: { read: () => idleLane(0) },
      moves: () => [],
    });
    expect(outcome.result).toBe("settled");
    expect(outcome.requests).toBe(0);
  });
});

test("a pending document placement in scope is awaited", async () => {
  await withTestExecSql("purge-move-settlement-document", async (execSql) => {
    const { localId } = await saveQueuedDocument(execSql, "folder");
    let reads = 0;
    const outcome = await settle({
      execSql,
      lane: { read: () => idleLane(0) },
      moves: async () => {
        reads += 1;
        if (reads === 2)
          await execSql("DELETE FROM local_intents WHERE local_id = ?", [
            localId,
          ]);
        return [];
      },
    });
    expect(outcome.result).toBe("settled");
    expect(outcome.settlements).toEqual(["waiting"]);
  });
});

test("stopping a waiting purge cancels it without a report", async () => {
  await withTestExecSql("purge-move-settlement-abort", async (execSql) => {
    const controller = new AbortController();
    const outcome = await settle({
      execSql,
      lane: { read: () => idleLane(0), request: () => controller.abort() },
      moves: () => [moveIntent("folder")],
      signal: controller.signal,
    });
    expect(outcome).toEqual({
      reports: [],
      requests: 1,
      result: "cancelled",
      settlements: ["waiting"],
    });
  });
});

test("a move that never replays ends the wait at the ceiling", async () => {
  await withTestExecSql("purge-move-settlement-timeout", async (execSql) => {
    const outcome = await settle({
      execSql,
      lane: { read: () => null },
      moves: () => [moveIntent("folder")],
      timeoutMs: 5,
    });
    expect(outcome.result).toBe("unsettled");
    expect(outcome.reports).toEqual(["Purge scope move wait timed out"]);
  });
});

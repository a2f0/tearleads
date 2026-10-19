import { listDocumentPlacementIntentStates } from "../../../../data/persistence/container-contents/documentPurgePlacement";
import { listDocumentsByContainerIdsOrDocumentIds } from "../../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import type { ContainerContentsPersistence } from "../../containerPersistence";
import type { ContainerState } from "../../remoteHydration";
import type { PurgeMoveSettlement } from "./purgeProgress";
import { collectSubtreeLeafFirst } from "./purgeTreeCollection";

/** The container-contents lane replays queued container and document moves. */
export interface PurgeMoveSyncLane {
  readonly read: () => {
    readonly lastStartedAt: string | null;
    readonly requested: boolean;
    readonly runCount: number;
    readonly running: boolean;
  } | null;
  readonly request: () => void;
}

interface ScopedIntent {
  readonly lastAttemptedAt: string | null;
  readonly syncStatus: string;
}

interface SettlePurgeScopeMovesInput {
  readonly containersById: ReadonlyMap<string, ContainerState>;
  readonly execSql: ExecSql;
  readonly lane: PurgeMoveSyncLane;
  readonly onMoveSettlement?:
    | ((settlement: PurgeMoveSettlement) => void)
    | undefined;
  readonly persistence: Pick<
    ContainerContentsPersistence,
    "listUnsyncedMoveIntents"
  >;
  /** Fixed messages only: the error's call site names the outcome. */
  readonly report: (message: string, error: Error) => void;
  readonly rootContainerId: string;
  readonly signal?: AbortSignal | undefined;
  readonly stillCurrent: () => boolean;
  readonly timing?: { pollMs: number; timeoutMs: number } | undefined;
}

// A pass replays pending and blocked moves. A denied placement waits for the
// next store generation and an unavailable one never replays, so waiting on
// either would only reach the ceiling.
const REPLAYED_STATUSES = new Set(["pending", "blocked"]);
const DEFAULT_TIMING = { pollMs: 200, timeoutMs: 30_000 };

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function createScopeReader(input: SettlePurgeScopeMovesInput) {
  const containerIds = new Set(
    collectSubtreeLeafFirst(input.containersById, input.rootContainerId).map(
      (containerState) => containerState.container.id,
    ),
  );
  let documentLocalIds: Promise<Set<string>> | null = null;
  // Listing the subtree's documents is the costly read, so it runs only once
  // some document placement is queued anywhere on this device.
  const readDocumentLocalIds = () => {
    documentLocalIds ??= listDocumentsByContainerIdsOrDocumentIds(
      input.execSql,
      { containerIds: [...containerIds], documentIds: [] },
    ).then((documents) => new Set(documents.map((document) => document.id)));
    return documentLocalIds;
  };
  return async (): Promise<ScopedIntent[]> => {
    const moves = await input.persistence.listUnsyncedMoveIntents(
      input.execSql,
    );
    const placements = await listDocumentPlacementIntentStates(input.execSql);
    const scoped: ScopedIntent[] = moves.filter((move) =>
      containerIds.has(move.containerId),
    );
    if (placements.length === 0) return scoped;
    const localIds = await readDocumentLocalIds();
    return [
      ...scoped,
      ...placements.filter((placement) => localIds.has(placement.localId)),
    ];
  };
}

type LaneRun = ReturnType<PurgeMoveSyncLane["read"]>;

const isParked = (intent: ScopedIntent) =>
  !REPLAYED_STATUSES.has(intent.syncStatus);

/** Why a wait that began at `startedAt` must stop, or null to keep polling. */
function stopReason(input: {
  deadline: number;
  intents: readonly ScopedIntent[];
  lane: LaneRun;
  startedAt: string | null;
}): { error: Error; message: string } | null {
  const { intents, lane, startedAt } = input;
  if (intents.some(isParked))
    return {
      error: new Error("Purge scope move was parked"),
      message: "Container contents: a move in the purge scope was parked",
    };
  if (
    startedAt !== null &&
    intents.some(
      ({ lastAttemptedAt }) =>
        lastAttemptedAt !== null && lastAttemptedAt >= startedAt,
    )
  )
    return {
      error: new Error("Purge scope move failed to sync"),
      message: "Container contents: a move in the purge scope failed to sync",
    };
  if (startedAt !== null && lane && !lane.running && !lane.requested)
    return {
      error: new Error("Purge scope move stayed queued"),
      message: "Container contents: a sync pass left a purge scope move queued",
    };
  if (Date.now() >= input.deadline)
    return {
      error: new Error("Purge scope move wait timed out"),
      message: "Container contents: purge timed out waiting for a move",
    };
  return null;
}

/**
 * The purge scope refuses a subtree whose moves the server has not accepted,
 * so ask for a pass that replays them and wait for its verdict. The scope's
 * own checks still run afterwards; this only gives the moves time to land.
 * It ends unsettled once a pass requested here has tried and left one queued.
 */
export async function settlePurgeScopeMoves(
  input: SettlePurgeScopeMovesInput,
): Promise<"cancelled" | "settled" | "unsettled"> {
  const timing = input.timing ?? DEFAULT_TIMING;
  const cancelled = () =>
    input.signal?.aborted === true || !input.stillCurrent();
  const unsettled = (reason: { error: Error; message: string }) => {
    input.report(reason.message, reason.error);
    input.onMoveSettlement?.("unsettled");
    return "unsettled" as const;
  };
  const readScope = createScopeReader(input);
  let intents = await readScope();
  if (cancelled()) return "cancelled";
  if (intents.length === 0) return "settled";
  if (intents.some(isParked))
    return unsettled({
      error: new Error("Purge scope holds a parked move"),
      message: "Container contents: purge scope holds a parked move",
    });

  input.onMoveSettlement?.("waiting");
  const runCountAtRequest = input.lane.read()?.runCount ?? 0;
  input.lane.request();
  const deadline = Date.now() + timing.timeoutMs;
  let startedAt: string | null = null;
  while (true) {
    await delay(timing.pollMs, input.signal);
    if (cancelled()) return "cancelled";
    // Read the lane first: a row still queued after a pass it shows finished
    // survived that pass, while one read before could have settled since.
    const lane = input.lane.read();
    intents = await readScope();
    if (cancelled()) return "cancelled";
    if (intents.length === 0) return "settled";
    // Only a pass that starts after the request answers it.
    if (lane && lane.runCount > runCountAtRequest)
      startedAt ??= lane.lastStartedAt;
    const reason = stopReason({ deadline, intents, lane, startedAt });
    if (reason) return unsettled(reason);
  }
}

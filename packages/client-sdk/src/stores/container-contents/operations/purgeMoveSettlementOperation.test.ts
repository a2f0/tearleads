import { expect, test } from "bun:test";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import {
  CONTAINER_MOVE_INTENT_TYPE,
  type ContainerMoveIntentRecord,
} from "../../../data/persistence/container-contents/containerContentsPersistenceTypes";
import { createDomainScope } from "../../../data/shared/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { ContainerState } from "../../../workflows/container-contents/remoteHydration";
import { invalidateRemoteContainerWrites } from "../remoteWrites/remoteWriteGuards";
import type { ContainerContentsStoreSyncAgent } from "../syncAgent";
import type { ContainerContentsStoreState } from "../types";
import { chainPurgeAfterScopeMoves } from "./purgeMoveSettlementOperation";

const queuedTrashMove: ContainerMoveIntentRecord = {
  containerId: "folder",
  createdAt: "2026-10-19T00:00:00.000Z",
  id: "move-folder",
  intentType: CONTAINER_MOVE_INTENT_TYPE,
  lastAttemptedAt: null,
  lastError: null,
  parentContainerId: "trash",
  previousParentContainerId: "root",
  syncStatus: "pending",
  updatedAt: "2026-10-19T00:00:00.000Z",
};

function containerState(id: string, parentId: string | null): ContainerState {
  return { container: { id, parentId } } as unknown as ContainerState;
}

/**
 * A store whose folder was just moved to Trash. `onSync` runs when the purge
 * asks for a pass; `queued` is what the intent table holds on each read.
 */
async function purgeTrashedFolder(input: {
  execSql: ExecSql;
  onRead?: (state: ContainerContentsStoreState) => void;
  onSync: (state: ContainerContentsStoreState) => void;
  queued: () => ContainerMoveIntentRecord[];
}) {
  const state = {
    containersById: new Map([
      ["root", containerState("root", null)],
      ["trash", containerState("trash", "root")],
      ["folder", containerState("folder", "trash")],
    ]),
    lifecycleGeneration: 0,
    persistence: {
      listUnsyncedMoveIntents: async () => {
        input.onRead?.(state);
        return input.queued();
      },
    },
    runtime: {
      auth: { isAuthenticated: true },
      crypto: {},
      infra: { dbStatus: "ready", execSql: input.execSql },
      state: { domainScope: createDomainScope(), online: true },
      util: { log: () => {} },
    },
    snapshot: { ready: true },
    writeChain: Promise.resolve(null),
    writeGeneration: 0,
  } as unknown as ContainerContentsStoreState;
  const syncAgent = {
    refreshLocalContainers: async () => {},
    scheduleRemoteHydration: () => {},
    scheduleSync: () => input.onSync(state),
  } as unknown as ContainerContentsStoreSyncAgent;
  const purges: boolean[] = [];
  const result = await chainPurgeAfterScopeMoves(
    state,
    syncAgent,
    "folder",
    undefined,
    async (isCurrent) => {
      purges.push(isCurrent());
      return true;
    },
  );
  return { purges, result };
}

test("a settled move lets the selected purge run", async () => {
  await withTestExecSql("purge-after-moves-settled", async (execSql) => {
    let queued = [queuedTrashMove];
    const outcome = await purgeTrashedFolder({
      execSql,
      onSync: () => {
        queued = [];
      },
      queued: () => queued,
    });
    expect(outcome).toEqual({ purges: [true], result: true });
  });
});

test("restoring the folder during the wait withdraws the purge", async () => {
  await withTestExecSql("purge-after-moves-restore", async (execSql) => {
    let queued = [queuedTrashMove];
    const outcome = await purgeTrashedFolder({
      execSql,
      onSync: (state) => {
        // A local Move out of Trash, as chainContainerWrite records it.
        const folder = state.containersById.get("folder");
        if (folder)
          folder.container = { ...folder.container, parentId: "root" };
        invalidateRemoteContainerWrites(state, ["folder", "root"], "folder");
        queued = [];
      },
      queued: () => queued,
    });
    expect(outcome).toEqual({ purges: [], result: false });
  });
});

test("a restore synced from a peer during the wait withdraws the purge", async () => {
  await withTestExecSql("purge-after-moves-peer", async (execSql) => {
    let queued = [queuedTrashMove];
    const outcome = await purgeTrashedFolder({
      execSql,
      onSync: (state) => {
        // Hydration installs the peer's placement without a local write.
        const folder = state.containersById.get("folder");
        if (folder)
          folder.container = { ...folder.container, parentId: "root" };
        queued = [];
      },
      queued: () => queued,
    });
    expect(outcome).toEqual({ purges: [], result: false });
  });
});

test("a runtime change during the first read cancels the purge", async () => {
  await withTestExecSql("purge-after-moves-runtime", async (execSql) => {
    const outcome = await purgeTrashedFolder({
      execSql,
      onRead: (state) => {
        state.writeGeneration += 1;
      },
      onSync: () => {},
      queued: () => [],
    });
    expect(outcome).toEqual({ purges: [], result: false });
  });
});

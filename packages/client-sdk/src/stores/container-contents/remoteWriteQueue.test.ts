import { expect, test } from "bun:test";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { createContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerWriteMethods } from "./containerContentsStore";
import { invalidateRemoteContainerWrites } from "./remoteWriteGuards";
import { chainRemoteContainerTask } from "./remoteWriteQueue";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
} from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";

async function createFixture() {
  const state = createContainerContentsStoreState(
    createContainerContentsTestRuntime({
      domainScope: {} as DomainScope,
      execSql: (async () => []) as ExecSql,
    }),
    defaultContainerContentsPersistence,
  );
  for (const [id, parentId] of [
    ["root", null],
    ["trash", "root"],
    ["trashed-child", "trash"],
    ["folder", "root"],
    ["note-folder", "folder"],
  ] as const) {
    state.containersById.set(id, {
      container: {
        id,
        parentId,
        name: id,
        icon: null,
        effectiveAccessLevel: "admin",
        metadataDocumentId: `${id}-metadata`,
        organizationId: "org-1",
      },
      doc: await createContainerMetadataDocument(id),
      record: {
        id,
        accessEpoch: 1,
        accessStateHash: null,
        contentKeyBundle: null,
        documentId: null,
        documentKekTargets: null,
        documentManifestBundle: null,
        lastCommitLsn: null,
        metadataUpdates: "",
        snapshotEndVersion: "",
      },
    });
  }
  const calls = { local: 0, remote: 0 };
  return {
    state,
    calls,
    syncAgent: {
      refreshLocalContainers: async () => {
        calls.local += 1;
      },
      scheduleRemoteHydration: () => {
        calls.remote += 1;
      },
    },
  };
}

for (const change of ["unrelated", "descendant", "move-ancestor"] as const) {
  test(`a remote sweep handles a concurrent ${change} edit without stale settlement`, async () => {
    const { state, calls, syncAgent } = await createFixture();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let settled = false;
    const sweep = chainRemoteContainerTask(
      state,
      syncAgent,
      false,
      async (current) => {
        started.resolve();
        await release.promise; // The remote side may have committed here.
        if (!current()) return false;
        settled = true;
        return true;
      },
      "trash",
    );
    try {
      await started.promise;
      if (change === "unrelated") {
        invalidateRemoteContainerWrites(state, ["folder"]);
        invalidateRemoteContainerWrites(state, ["root"]); // Create a sibling.
      } else if (change === "descendant") {
        invalidateRemoteContainerWrites(state, ["trashed-child"]);
      } else {
        invalidateRemoteContainerWrites(state, ["root"], "root");
      }
      release.resolve();
      expect(await sweep).toBe(change === "unrelated");
      expect(settled).toBe(change === "unrelated");
      expect(calls).toEqual(
        change === "unrelated"
          ? { local: 0, remote: 0 }
          : { local: 1, remote: 1 },
      );
    } finally {
      release.resolve();
      await sweep;
      for (const entry of state.containersById.values()) entry.doc.free();
    }
  });
}

test("a changed runtime starts remote work without waiting for an abandoned request", async () => {
  const { state, syncAgent } = await createFixture();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const stale = chainRemoteContainerTask(
    state,
    syncAgent,
    false,
    async () => {
      started.resolve();
      await release.promise;
      return true;
    },
    "trash",
  );
  try {
    await started.promise;
    state.writeGeneration += 1;
    expect(
      await chainRemoteContainerTask(
        state,
        syncAgent,
        false,
        async () => true,
        "trash",
      ),
    ).toBe(true);
    release.resolve();
    expect(await stale).toBe(false);
  } finally {
    release.resolve();
    await stale;
    for (const entry of state.containersById.values()) entry.doc.free();
  }
});

for (const scope of ["root", "trash"]) {
  test(`a deferred system-folder ensure does not cancel a remote ${scope} sweep`, async () => {
    const { state, calls, syncAgent } = await createFixture();
    const slot =
      "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as ContainerSystemSlot;
    const trash = state.containersById.get("trash");
    if (!trash) throw new Error("Missing Trash fixture");
    trash.container.systemSlot = slot;
    trash.record.documentId = "trash-metadata";
    updateContainerContentsSnapshot(state);
    const unexpected = () => {
      throw new Error("Unexpected background work");
    };
    const fullSyncAgent: ContainerContentsStoreSyncAgent = {
      ...syncAgent,
      ensureInitialized: unexpected,
      handleRemoteEvents: unexpected,
      ingestRemoteContainer: async () => unexpected(),
      primeDocumentsForSharedSubtree: async () => unexpected(),
      refresh: async () => unexpected(),
      refreshRootLane: async () => unexpected(),
      requestRemoteHydration: async () => unexpected(),
      scheduleSync: unexpected,
    };
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const sweep = chainRemoteContainerTask(
      state,
      syncAgent,
      false,
      async (current) => {
        started.resolve();
        await release.promise;
        return current();
      },
      scope,
    );
    try {
      await started.promise;
      const writes = createContainerWriteMethods(state, fullSyncAgent);
      expect(
        (
          await writes.ensureSystemContainer(slot, "Trash", {
            deferRemoteBootstrap: true,
          })
        )?.id,
      ).toBe("trash");
      release.resolve();
      expect(await sweep).toBe(true);
      expect(calls).toEqual({ local: 0, remote: 0 });
    } finally {
      release.resolve();
      await sweep;
      for (const entry of state.containersById.values()) entry.doc.free();
    }
  });
}

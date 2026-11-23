import { expect, test } from "bun:test";
import type { DocumentSummary } from "../../data/documents/documentSummary";
import type { ContainerNode } from "../../stores/container-contents";
import type { LocalProjectionReconcileListener } from "../../stores/local-projection/localProjectionStore";
import { syncedContainerDocumentObjectSyncState } from "../../workflows/container-contents/syncState";
import {
  type DiscoveredDocumentTarget,
  startDiscoveredDocumentPrimer,
} from "./discoveredDocumentPrimer";

function container(input: {
  readonly id: string;
  readonly organizationId?: string;
  readonly parentId?: string | null;
  readonly systemSlot?: string | null;
}): ContainerNode {
  return {
    id: input.id,
    kind: "container",
    metadataDocumentId: `${input.id}-metadata`,
    name: input.id,
    organizationId: input.organizationId ?? "org-a",
    parentId: input.parentId === undefined ? "root" : input.parentId,
    syncState: syncedContainerDocumentObjectSyncState,
    systemSlot: input.systemSlot ?? null,
  };
}

function summary(
  containerId: string,
  id: string,
  documentId: string | null = `${id}-remote`,
): DocumentSummary {
  return {
    containerId,
    documentId,
    id,
    title: id,
    updatedAt: "2026-11-23T00:00:00.000Z",
  };
}

function createHarness(
  initial: {
    readonly containers?: ReadonlyArray<ContainerNode>;
    readonly summaries?: ReadonlyMap<string, ReadonlyArray<DocumentSummary>>;
  } = {},
) {
  let containers = initial.containers ?? [];
  let summaries = initial.summaries ?? new Map();
  const projectionListeners = new Set<() => void>();
  const signalListeners = new Set<LocalProjectionReconcileListener>();
  const pauseListeners = new Set<() => void>();
  const pausedOrganizations = new Set<string>();
  const openCalls: DiscoveredDocumentTarget[][] = [];
  const state = {
    canPrime: true,
    pausesReadable: true,
  };

  const stop = startDiscoveredDocumentPrimer({
    canPrime: () => state.canPrime,
    isContainerPaused: (subject) =>
      pausedOrganizations.has(subject.organizationId) &&
      !(subject.parentId === null && Boolean(subject.systemSlot)),
    loadSyncPauses: () =>
      state.pausesReadable
        ? Promise.resolve()
        : Promise.reject(new Error("pauses unreadable")),
    openDocuments: (targets) => {
      openCalls.push([...targets]);
    },
    projection: {
      getSnapshot: () => ({
        containers,
        documentSummariesByContainerId: summaries,
        linkedContainerIdsByDocumentId: new Map(),
        ready: true,
      }),
      onReconcileSignal: (listener) => {
        signalListeners.add(listener);
        return () => signalListeners.delete(listener);
      },
      subscribe: (listener) => {
        projectionListeners.add(listener);
        return () => projectionListeners.delete(listener);
      },
    },
    subscribeToSyncPauses: (listener) => {
      pauseListeners.add(listener);
      return () => pauseListeners.delete(listener);
    },
  });

  return {
    openCalls,
    opened: () => openCalls.flat().map((target) => target.localId),
    pauseListeners,
    pausedOrganizations,
    projectionListeners,
    signalListeners,
    state,
    stop,
    emitProjection(next: {
      readonly containers?: ReadonlyArray<ContainerNode>;
      readonly summaries?: ReadonlyMap<string, ReadonlyArray<DocumentSummary>>;
    }) {
      containers = next.containers ?? containers;
      summaries = next.summaries ?? summaries;
      for (const listener of projectionListeners) listener();
    },
    emitSignal() {
      for (const listener of signalListeners) {
        listener({ activeContainerId: null, reason: "prerequisites-regained" });
      }
    },
    emitPauses() {
      for (const listener of pauseListeners) listener();
    },
  };
}

/** Lets scheduled passes and their awaited pause reads finish. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("opens each discovered document once per published summary list", async () => {
  const listA = [summary("folder", "note-1"), summary("folder", "draft", null)];
  const harness = createHarness({
    containers: [container({ id: "folder" })],
    summaries: new Map([["folder", listA]]),
  });

  await flush();
  // A local-only draft has no remote content to pull.
  expect(harness.openCalls).toEqual([
    [{ containerId: "folder", documentId: "note-1-remote", localId: "note-1" }],
  ]);

  // The same list again is not new work.
  harness.emitProjection({ summaries: new Map([["folder", listA]]) });
  await flush();
  expect(harness.opened()).toEqual(["note-1"]);

  // The projection swaps the list when the container's documents change.
  harness.emitProjection({
    summaries: new Map([
      ["folder", [summary("folder", "note-1"), summary("folder", "note-2")]],
    ]),
  });
  await flush();
  expect(harness.opened()).toEqual(["note-1", "note-1", "note-2"]);
  harness.stop();
});

test("coalesces a burst of projection changes into one pass", async () => {
  const harness = createHarness({ containers: [container({ id: "folder" })] });
  await flush();

  for (let index = 0; index < 5; index += 1) {
    harness.emitProjection({
      summaries: new Map([["folder", [summary("folder", `note-${index}`)]]]),
    });
  }
  await flush();

  expect(harness.openCalls).toEqual([
    [{ containerId: "folder", documentId: "note-4-remote", localId: "note-4" }],
  ]);
  harness.stop();
});

test("waits until the scope can sync, then opens what it held", async () => {
  const harness = createHarness({
    containers: [container({ id: "folder" })],
    summaries: new Map([["folder", [summary("folder", "note-1")]]]),
  });
  harness.state.canPrime = false;
  await flush();
  harness.emitProjection({});
  await flush();
  expect(harness.opened()).toEqual([]);

  harness.state.canPrime = true;
  harness.emitSignal();
  await flush();
  expect(harness.opened()).toEqual(["note-1"]);
  harness.stop();
});

test("skips a paused organization's documents until it resumes", async () => {
  const harness = createHarness({
    containers: [
      container({ id: "own", organizationId: "org-a" }),
      container({ id: "shared", organizationId: "org-b" }),
      container({
        id: "metadata-root",
        organizationId: "org-b",
        parentId: null,
        systemSlot: "sys_org_metadata",
      }),
    ],
    summaries: new Map([
      ["own", [summary("own", "own-note")]],
      ["shared", [summary("shared", "shared-note")]],
      ["metadata-root", [summary("metadata-root", "profile")]],
    ]),
  });
  harness.pausedOrganizations.add("org-b");
  await flush();
  // The paused organization's metadata root keeps syncing, as the pause rule
  // allows; its ordinary folders do not.
  expect(harness.opened().sort()).toEqual(["own-note", "profile"]);

  // Still paused: unrelated projection changes do not open it.
  harness.emitProjection({});
  await flush();
  expect(harness.opened().sort()).toEqual(["own-note", "profile"]);

  // Resuming notifies the pause subscribers; the held list was never marked.
  harness.pausedOrganizations.delete("org-b");
  harness.emitPauses();
  await flush();
  expect(harness.opened().sort()).toEqual([
    "own-note",
    "profile",
    "shared-note",
  ]);
  harness.stop();
});

test("pausing after a list was opened does not reopen or extend it", async () => {
  const harness = createHarness({
    containers: [container({ id: "shared", organizationId: "org-b" })],
    summaries: new Map([["shared", [summary("shared", "first")]]]),
  });
  await flush();
  expect(harness.opened()).toEqual(["first"]);

  harness.pausedOrganizations.add("org-b");
  harness.emitPauses();
  harness.emitProjection({
    summaries: new Map([
      ["shared", [summary("shared", "first"), summary("shared", "second")]],
    ]),
  });
  await flush();
  expect(harness.opened()).toEqual(["first"]);
  harness.stop();
});

test("holds every organization while the pauses cannot be read", async () => {
  const harness = createHarness({
    containers: [container({ id: "folder" })],
    summaries: new Map([["folder", [summary("folder", "note-1")]]]),
  });
  harness.state.pausesReadable = false;
  await flush();
  expect(harness.opened()).toEqual([]);

  // A later pass reads them again and opens what it held.
  harness.state.pausesReadable = true;
  harness.emitProjection({});
  await flush();
  expect(harness.opened()).toEqual(["note-1"]);
  harness.stop();
});

test("holds a list until the tree holds its container", async () => {
  const harness = createHarness({
    summaries: new Map([["late", [summary("late", "note-1")]]]),
  });
  await flush();
  expect(harness.opened()).toEqual([]);

  harness.emitProjection({ containers: [container({ id: "late" })] });
  await flush();
  expect(harness.opened()).toEqual(["note-1"]);
  harness.stop();
});

test("stopping unsubscribes and opens nothing further", async () => {
  const harness = createHarness({
    containers: [container({ id: "folder" })],
    summaries: new Map([["folder", [summary("folder", "note-1")]]]),
  });
  harness.stop();
  await flush();

  expect(harness.opened()).toEqual([]);
  expect(harness.projectionListeners.size).toBe(0);
  expect(harness.signalListeners.size).toBe(0);
  expect(harness.pauseListeners.size).toBe(0);
});

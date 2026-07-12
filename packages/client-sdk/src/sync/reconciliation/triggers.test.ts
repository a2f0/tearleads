import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import type {
  LocalProjectionReconcileListener,
  LocalProjectionReconcileSignal,
  LocalProjectionStore,
} from "../../stores/local-projection/localProjectionStore";
import { markOriginatedDocuments } from "./originatedDocuments";
import {
  connectReconciliationTriggers,
  enqueueReconciliationForEvents,
} from "./triggers";

test("prerequisites-regained trigger resets the discovered set first", () => {
  const reconcileListeners: LocalProjectionReconcileListener[] = [];
  const store = {
    onReconcileSignal: (listener: LocalProjectionReconcileListener) => {
      reconcileListeners.push(listener);
      return () => {
        reconcileListeners.splice(reconcileListeners.indexOf(listener), 1);
      };
    },
  } as LocalProjectionStore;
  const calls: string[] = [];
  const service = {
    enqueueContainer: (containerId: string) => {
      calls.push(`enqueue:${containerId}`);
    },
    enqueueIdleBackfill: () => {
      calls.push("backfill");
    },
    resetDiscovered: () => {
      calls.push("reset");
    },
    setActiveContainer: () => {},
  } as unknown as Parameters<
    typeof connectReconciliationTriggers
  >[0]["service"];

  connectReconciliationTriggers({ service, store });
  const reconcileListener = reconcileListeners[0];
  if (!reconcileListener) {
    throw new Error(
      "Expected reconciliation trigger listener to be connected.",
    );
  }
  reconcileListener({
    activeContainerId: "c-1",
    reason: "prerequisites-regained",
  });

  // Reset must happen before the enqueue/backfill, otherwise those calls are
  // suppressed for already-discovered containers.
  expect(calls).toEqual(["reset", "enqueue:c-1", "backfill"]);
});

test("hydrated trigger reconciles only the active container", () => {
  const reconcileListeners: LocalProjectionReconcileListener[] = [];
  const store = {
    onReconcileSignal: (listener: LocalProjectionReconcileListener) => {
      reconcileListeners.push(listener);
      return () => {
        reconcileListeners.splice(reconcileListeners.indexOf(listener), 1);
      };
    },
  } as LocalProjectionStore;
  const calls: Array<{ containerId: string; priority: string }> = [];
  let idleBackfills = 0;
  const service = {
    enqueueContainer: (containerId: string, priority: string) => {
      calls.push({ containerId, priority });
    },
    enqueueIdleBackfill: () => {
      idleBackfills += 1;
    },
    setActiveContainer: () => {},
  } as unknown as Parameters<
    typeof connectReconciliationTriggers
  >[0]["service"];

  connectReconciliationTriggers({ service, store });
  const reconcileListener = reconcileListeners[0];
  if (!reconcileListener) {
    throw new Error(
      "Expected reconciliation trigger listener to be connected.",
    );
  }
  const signal: LocalProjectionReconcileSignal = {
    activeContainerId: "c-1",
    reason: "hydrated",
  };
  reconcileListener(signal);

  expect(calls).toEqual([{ containerId: "c-1", priority: "active" }]);
  expect(idleBackfills).toBe(0);
});

test("remote container growth queues one idle backfill", () => {
  const reconcileListeners: LocalProjectionReconcileListener[] = [];
  const store = {
    onReconcileSignal: (listener: LocalProjectionReconcileListener) => {
      reconcileListeners.push(listener);
      return () => {};
    },
  } as LocalProjectionStore;
  let idleBackfills = 0;
  const service = {
    enqueueIdleBackfill: () => {
      idleBackfills += 1;
    },
    setActiveContainer: () => {},
  } as unknown as Parameters<
    typeof connectReconciliationTriggers
  >[0]["service"];

  connectReconciliationTriggers({ service, store });
  const reconcileListener = reconcileListeners[0];
  if (!reconcileListener) {
    throw new Error(
      "Expected reconciliation trigger listener to be connected.",
    );
  }
  reconcileListener({
    activeContainerId: null,
    reason: "remote-containers-added",
  });

  expect(idleBackfills).toBe(1);
});

test("event triggers enqueue the named container at active priority", () => {
  const enqueued: Array<{
    containerId: string;
    force: boolean | undefined;
    priority: string;
  }> = [];
  const service = {
    enqueueContainer: (
      containerId: string,
      priority: string,
      force: boolean | undefined,
    ) => {
      enqueued.push({ containerId, force, priority });
    },
    enqueueIdleBackfill: () => {
      enqueued.push({ containerId: "*", force: undefined, priority: "idle" });
    },
  } as unknown as Parameters<
    typeof enqueueReconciliationForEvents
  >[0]["service"];

  enqueueReconciliationForEvents({
    events: [
      {
        type: "document_update_created",
        documentId: "d-1",
        containerIds: ["c-1"],
      },
      {
        type: "document_update_created",
        documentId: "d-2",
        containerIds: ["unknown"],
      },
    ],
    knownContainerIds: ["c-1", "c-2"],
    service,
  });

  expect(enqueued).toEqual([
    { containerId: "c-1", force: true, priority: "active" },
  ]);
});

test("document mutation events force both prior and current containers", () => {
  const enqueued: Array<{
    containerId: string;
    force: boolean | undefined;
    priority: string;
  }> = [];
  const service = {
    enqueueContainer: (
      containerId: string,
      priority: string,
      force: boolean | undefined,
    ) => {
      enqueued.push({ containerId, force, priority });
    },
    enqueueIdleBackfill: () => {},
  } as unknown as Parameters<
    typeof enqueueReconciliationForEvents
  >[0]["service"];

  enqueueReconciliationForEvents({
    events: [
      {
        type: "document_mutation_created",
        containerIds: ["root", "trash", "unknown"],
        documentId: "d-1",
        eventType: "document.unlink",
      },
    ],
    knownContainerIds: ["root", "trash"],
    service,
  });

  expect(enqueued).toEqual([
    { containerId: "root", force: true, priority: "active" },
    { containerId: "trash", force: true, priority: "active" },
  ]);
});

test("document mutation events do not consume content self-echo suppression", () => {
  const enqueued: string[] = [];
  const service = {
    enqueueContainer: (containerId: string) => {
      enqueued.push(containerId);
    },
    enqueueIdleBackfill: () => {},
  } as unknown as Parameters<
    typeof enqueueReconciliationForEvents
  >[0]["service"];
  const domainScope = createDomainScope();
  markOriginatedDocuments(domainScope, ["d-1"]);

  enqueueReconciliationForEvents({
    domainScope,
    events: [
      {
        type: "document_mutation_created",
        containerIds: ["root", "trash"],
        documentId: "d-1",
        eventType: "document.unlink",
      },
    ],
    knownContainerIds: ["root", "trash"],
    service,
  });
  enqueueReconciliationForEvents({
    domainScope,
    events: [
      {
        type: "document_update_created",
        containerIds: ["root"],
        documentId: "d-1",
      },
    ],
    knownContainerIds: ["root", "trash"],
    service,
  });

  // The structural event always reconciles. The following content self-echo is
  // still suppressed, proving the structural path did not consume its marker.
  expect(enqueued).toEqual(["root", "trash"]);
});

test("event triggers skip self-echoes of originated documents", () => {
  const enqueued: string[] = [];
  const service = {
    enqueueContainer: (containerId: string) => {
      enqueued.push(containerId);
    },
    enqueueIdleBackfill: () => {
      enqueued.push("*");
    },
  } as unknown as Parameters<
    typeof enqueueReconciliationForEvents
  >[0]["service"];
  const domainScope = createDomainScope();
  markOriginatedDocuments(domainScope, ["d-self"]);

  enqueueReconciliationForEvents({
    domainScope,
    events: [
      {
        type: "document_update_created",
        documentId: "d-self",
        containerIds: ["c-1"],
      },
      {
        type: "document_update_created",
        documentId: "d-other",
        containerIds: ["c-1"],
      },
    ],
    knownContainerIds: ["c-1"],
    service,
  });

  // The self-echo is dropped; the genuinely-remote document still enqueues.
  expect(enqueued).toEqual(["c-1"]);
});

test("self-echo suppression is single-use", () => {
  const enqueued: string[] = [];
  const service = {
    enqueueContainer: (containerId: string) => {
      enqueued.push(containerId);
    },
    enqueueIdleBackfill: () => {},
  } as unknown as Parameters<
    typeof enqueueReconciliationForEvents
  >[0]["service"];
  const domainScope = createDomainScope();
  markOriginatedDocuments(domainScope, ["d-1"]);
  const event = {
    type: "document_update_created",
    documentId: "d-1",
    containerIds: ["c-1"],
  };

  // First echo consumes the origination and is suppressed.
  enqueueReconciliationForEvents({
    domainScope,
    events: [event],
    knownContainerIds: ["c-1"],
    service,
  });
  // A later genuine remote change to the same document is no longer suppressed.
  enqueueReconciliationForEvents({
    domainScope,
    events: [event],
    knownContainerIds: ["c-1"],
    service,
  });

  expect(enqueued).toEqual(["c-1"]);
});

test("event triggers backfill when an update has no container scope", () => {
  let idleBackfills = 0;
  const service = {
    enqueueContainer: () => {},
    enqueueIdleBackfill: () => {
      idleBackfills += 1;
    },
  } as unknown as Parameters<
    typeof enqueueReconciliationForEvents
  >[0]["service"];

  enqueueReconciliationForEvents({
    events: [{ type: "document_update_created", documentId: "d-1" }],
    knownContainerIds: ["c-1"],
    service,
  });

  expect(idleBackfills).toBe(1);
});

import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import type {
  LocalProjectionReconcileListener,
  LocalProjectionReconcileSignal,
  LocalProjectionStore,
} from "../../stores/local-projection/localProjectionStore";
import { markOriginatedDocuments } from "./originatedDocuments";
import type { ReconciliationService } from "./serviceTypes";
import {
  connectReconciliationTriggers,
  enqueueReconciliationForEvents,
} from "./triggers";

/** Build a reconciliation service stub from just the methods a test observes. */
function stubService(
  overrides: Partial<ReconciliationService>,
): ReconciliationService {
  return {
    enqueueContainer: () => {},
    enqueueIdleBackfill: () => {},
    setActiveContainer: () => {},
    ...overrides,
  } as ReconciliationService;
}

/** Connect the triggers to a stub store and return the captured listener. */
function connectListener(
  service: ReconciliationService,
): LocalProjectionReconcileListener {
  const reconcileListeners: LocalProjectionReconcileListener[] = [];
  const store = {
    onReconcileSignal: (listener: LocalProjectionReconcileListener) => {
      reconcileListeners.push(listener);
      return () => {
        reconcileListeners.splice(reconcileListeners.indexOf(listener), 1);
      };
    },
  } as LocalProjectionStore;
  connectReconciliationTriggers({ service, store });
  const reconcileListener = reconcileListeners[0];
  if (!reconcileListener) {
    throw new Error(
      "Expected reconciliation trigger listener to be connected.",
    );
  }
  return reconcileListener;
}

test("prerequisites-regained trigger resets the discovered set first", () => {
  const calls: string[] = [];
  const reconcileListener = connectListener(
    stubService({
      enqueueContainer: (containerId) => {
        calls.push(`enqueue:${containerId}`);
      },
      enqueueIdleBackfill: () => {
        calls.push("backfill");
      },
      resetDiscovered: () => {
        calls.push("reset");
      },
    }),
  );
  reconcileListener({
    activeContainerId: "c-1",
    reason: "prerequisites-regained",
  });

  // Reset must happen before the enqueue/backfill, otherwise those calls are
  // suppressed for already-discovered containers.
  expect(calls).toEqual(["reset", "enqueue:c-1", "backfill"]);
});

test("hydrated trigger reconciles only the active container", () => {
  const calls: Array<{ containerId: string; priority: string }> = [];
  let idleBackfills = 0;
  const reconcileListener = connectListener(
    stubService({
      enqueueContainer: (containerId, priority) => {
        calls.push({ containerId, priority });
      },
      enqueueIdleBackfill: () => {
        idleBackfills += 1;
      },
    }),
  );
  const signal: LocalProjectionReconcileSignal = {
    activeContainerId: "c-1",
    reason: "hydrated",
  };
  reconcileListener(signal);

  expect(calls).toEqual([{ containerId: "c-1", priority: "active" }]);
  expect(idleBackfills).toBe(0);
});

test("remote container growth queues one idle backfill", () => {
  const idleBackfills: Array<boolean | undefined> = [];
  const reconcileListener = connectListener(
    stubService({
      enqueueIdleBackfill: (force) => {
        idleBackfills.push(force);
      },
    }),
  );
  reconcileListener({
    activeContainerId: null,
    reason: "remote-containers-added",
  });

  expect(idleBackfills).toEqual([undefined]);
});

test("event triggers enqueue the named container at active priority", () => {
  const enqueued: Array<{
    containerId: string;
    force: boolean | undefined;
    priority: string;
  }> = [];
  const service = stubService({
    enqueueContainer: (containerId, priority, force) => {
      enqueued.push({ containerId, force, priority });
    },
    enqueueIdleBackfill: () => {
      enqueued.push({ containerId: "*", force: undefined, priority: "idle" });
    },
  });

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
  const service = stubService({
    enqueueContainer: (containerId, priority, force) => {
      enqueued.push({ containerId, force, priority });
    },
  });

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

test("document purge events force every prior container", () => {
  const enqueued: string[] = [];
  const service = stubService({
    enqueueContainer: (containerId) => {
      enqueued.push(containerId);
    },
  });

  enqueueReconciliationForEvents({
    events: [
      {
        type: "document_mutation_created",
        containerIds: ["root", "archive", "unknown"],
        documentId: "d-1",
        eventType: "document.purge",
      },
    ],
    knownContainerIds: ["root", "archive"],
    service,
  });

  expect(enqueued).toEqual(["root", "archive"]);
});

test("document mutation events do not consume content self-echo suppression", () => {
  const enqueued: string[] = [];
  const service = stubService({
    enqueueContainer: (containerId) => {
      enqueued.push(containerId);
    },
  });
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
  const service = stubService({
    enqueueContainer: (containerId) => {
      enqueued.push(containerId);
    },
    enqueueIdleBackfill: () => {
      enqueued.push("*");
    },
  });
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
  const service = stubService({
    enqueueContainer: (containerId) => {
      enqueued.push(containerId);
    },
  });
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
  const idleBackfills: Array<boolean | undefined> = [];
  const service = stubService({
    enqueueIdleBackfill: (force) => {
      idleBackfills.push(force);
    },
  });

  enqueueReconciliationForEvents({
    events: [
      { type: "document_update_created", documentId: "d-1" },
      { type: "document_update_created", documentId: "d-2" },
    ],
    knownContainerIds: ["c-1"],
    service,
  });

  expect(idleBackfills).toEqual([true]);
});

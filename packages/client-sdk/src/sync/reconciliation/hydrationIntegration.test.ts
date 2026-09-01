import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { waitFor } from "../../../test/helpers/waitFor";
import { createDomainScope } from "../../data/domainScope";
import { createContainerContentsTestRuntime } from "../../stores/container-contents/runtime.testFixtures";
import type {
  ContainerContentsStore,
  ContainerNode,
} from "../../stores/container-contents/types";
import { createLocalProjectionStore } from "../../stores/local-projection/localProjectionStore";
import { createReconciliationService } from "./service";
import { createReconciliationTestHost } from "./service.testFixtures";
import {
  connectReconciliationTriggers,
  enqueueReconciliationForEvents,
} from "./triggers";

function remoteContainer(id: string): ContainerNode {
  return {
    effectiveAccessLevel: "admin",
    id,
    kind: "container",
    metadataDocumentId: `${id}-metadata`,
    name: id,
    organizationId: "org-1",
    parentId: null,
    syncState: {
      lastError: null,
      pendingAttachmentBytes: 0,
      pendingAttachmentCount: 0,
      pendingUpdateCount: 0,
      status: "synced",
    },
    systemSlot: null,
  };
}

test("initial hydration flushes unscoped invalidation over the fresh tree", async () => {
  const { close, execSql } = await createTestExecSql(
    "reconciliation-hydration-order-test",
  );
  try {
    let emitContainerStore = () => {};
    let nodes: ReadonlyArray<ContainerNode> = [];
    let ready = false;
    const containerStore = {
      getSnapshot: () => ({ nodes, ready }),
      subscribe: (listener: () => void) => {
        emitContainerStore = listener;
        return () => undefined;
      },
      updateRuntime: () => undefined,
    } as unknown as ContainerContentsStore;
    const runtime = createContainerContentsTestRuntime({
      apiClient: createMockApiClient(),
      dbStatus: "ready",
      domainScope: createDomainScope(),
      execSql,
      isAuthenticated: true,
      online: true,
    });
    const store = createLocalProjectionStore({ containerStore, runtime });
    const contentPulls: Array<{ containerId: string; force: boolean }> = [];
    const service = createReconciliationService(
      createReconciliationTestHost({
        listKnownContainerIds: () =>
          store.getSnapshot().containers.map((container) => container.id),
        requestDocumentContentPull: (containerId, _documents, force) => {
          contentPulls.push({ containerId, force });
        },
      }),
    );
    connectReconciliationTriggers({ service, store });
    service.start();

    enqueueReconciliationForEvents({
      events: [{ type: "document_update_created", documentId: "d-1" }],
      knownContainerIds: [],
      service,
    });
    nodes = [remoteContainer("c-1"), remoteContainer("c-2")];
    ready = true;
    emitContainerStore();
    await waitFor(
      () => contentPulls.length === 2,
      "Expected hydration backfill",
    );

    expect(contentPulls).toEqual([
      { containerId: "c-1", force: true },
      { containerId: "c-2", force: true },
    ]);
  } finally {
    close();
  }
});

test("remote backing reconciles an active write-only system container", async () => {
  const { close, execSql } = await createTestExecSql(
    "reconciliation-active-remote-backing-test",
  );
  try {
    const foreignSystem: ContainerNode = {
      ...remoteContainer("foreign-system"),
      effectiveAccessLevel: "write",
      metadataDocumentId: null,
      organizationId: "org-2",
      systemSlot: "sys_v1_contacts",
    };
    let nodes: ReadonlyArray<ContainerNode> = [foreignSystem];
    let emitContainerStore = () => {};
    const containerStore = {
      getSnapshot: () => ({ nodes, ready: true }),
      subscribe: (listener: () => void) => {
        emitContainerStore = listener;
        return () => undefined;
      },
      updateRuntime: () => undefined,
    } as unknown as ContainerContentsStore;
    const runtime = createContainerContentsTestRuntime({
      apiClient: createMockApiClient(),
      dbStatus: "ready",
      domainScope: createDomainScope(),
      execSql,
      isAuthenticated: true,
      online: true,
    });
    const store = createLocalProjectionStore({ containerStore, runtime });
    const contentPulls: boolean[] = [];
    const service = createReconciliationService(
      createReconciliationTestHost({
        canDiscoverContainerDocuments: (containerId) =>
          store
            .getSnapshot()
            .containers.some(
              (container) =>
                container.id === containerId &&
                typeof container.metadataDocumentId === "string",
            ),
        listKnownContainerIds: () => [],
        requestDocumentContentPull: (_containerId, _documents, force) => {
          contentPulls.push(force);
        },
      }),
    );
    connectReconciliationTriggers({ service, store });
    service.start();
    store.updateRuntime(runtime);
    store.setActiveContainer(foreignSystem.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(contentPulls).toEqual([]);

    nodes = [{ ...foreignSystem, metadataDocumentId: "foreign-metadata" }];
    emitContainerStore();
    await waitFor(() => contentPulls.length === 1, "Expected active backfill");

    expect(contentPulls).toEqual([false]);
  } finally {
    close();
  }
});

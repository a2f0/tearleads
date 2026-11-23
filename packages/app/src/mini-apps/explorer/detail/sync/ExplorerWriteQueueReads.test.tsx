import { afterEach, expect, test } from "bun:test";
import type {
  ContainerDocumentQueries,
  PendingWriteQueueItem,
} from "@tearleads/client-sdk";
import {
  createDomainScope,
  type DomainScope,
  getDomainSyncCoordinatorSnapshot,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import {
  ARCHIVE_NODE,
  item,
  uploadManager,
} from "../../../../../test/helpers/explorer/syncPanelFixtures";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerOutgoingPanel } from "../transfers/ExplorerOutgoingPanel";

// How the Outgoing tab reads the durable write queue through its shared store.

afterEach(() => cleanup());

function renderPanelLoader(
  documentQueries: ContainerDocumentQueries,
  domainScope = createDomainScope(),
  dbReady = true,
) {
  return render(panel(documentQueries, domainScope, dbReady));
}

function panel(
  documentQueries: ContainerDocumentQueries,
  domainScope: DomainScope,
  dbReady: boolean,
) {
  return (
    <ExplorerOutgoingPanel
      billingBlockedOrganizationId={null}
      dbReady={dbReady}
      documentQueries={documentQueries}
      domainScope={domainScope}
      isAuthenticated={true}
      nodes={[ARCHIVE_NODE]}
      online={true}
      openContainerInfoRoute={() => undefined}
      openDocument={() => undefined}
      openWriteQueueEntryRoute={() => undefined}
      organizationNamesById={new Map()}
      selectedEntryKey={null}
      uploadManager={uploadManager()}
    />
  );
}

test("reads nothing into the shared queue while the database is closed", async () => {
  let queryCount = 0;
  const documentQueries = {
    listPendingWrites: () => {
      queryCount += 1;
      return Promise.reject(new Error("Database is locked"));
    },
  } as unknown as ContainerDocumentQueries;
  const domainScope = createDomainScope();

  const view = renderPanelLoader(documentQueries, domainScope, false);
  await act(async () => {
    await Promise.resolve();
  });
  // A failure here would reach the tray and System Monitor through the store.
  expect(queryCount).toBe(0);
  expect(view.queryByText("Database is locked")).toBeNull();
});

test("closing the database hides the rows and their actions until it reopens", async () => {
  const documentQueries = {
    listPendingWrites: async () => [item()],
  } as unknown as ContainerDocumentQueries;
  const domainScope = createDomainScope();
  const view = renderPanelLoader(documentQueries, domainScope);
  const row = { name: "Open object: Offline note" };
  expect(await view.findByRole("button", row)).toBeTruthy();

  view.rerender(panel(documentQueries, domainScope, false));
  expect(view.queryByRole("button", row)).toBeNull();
  expect(view.getByText(EXPLORER_LABELS.writeQueueLoading)).toBeTruthy();

  view.rerender(panel(documentQueries, domainScope, true));
  expect(view.getByRole("button", row)).toBeTruthy();
});

test("coalesces a burst of sync signals and keeps stale rows while re-reading", async () => {
  let queryCount = 0;
  const resolvers: Array<
    (items: ReadonlyArray<PendingWriteQueueItem>) => void
  > = [];
  const documentQueries = {
    listPendingWrites: () => {
      queryCount += 1;
      return new Promise<ReadonlyArray<PendingWriteQueueItem>>((resolve) => {
        resolvers.push(resolve);
      });
    },
  } as unknown as ContainerDocumentQueries;
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);

  const view = renderPanelLoader(documentQueries, domainScope);
  expect(queryCount).toBe(1);

  // A burst of sync signals while the first scan is still pending must queue
  // exactly one re-read, not one heavy scan per signal.
  await act(async () => {
    for (const key of ["burst-a", "burst-b", "burst-c"]) {
      coordinator.registerLane(key, { run: async () => undefined });
    }
  });
  expect(queryCount).toBe(1);

  await act(async () => {
    resolvers[0]?.([item()]);
  });

  // The stale first result stays on screen while the queued re-read runs; the
  // panel must not flip back to its loading state.
  expect(
    view.getByRole("button", { name: "Open object: Offline note" }),
  ).toBeTruthy();
  expect(view.queryByText(EXPLORER_LABELS.writeQueueLoading)).toBeNull();

  await waitFor(() => expect(queryCount).toBe(2), { timeout: 2000 });
  await act(async () => {
    resolvers[1]?.([]);
  });

  await waitFor(() =>
    expect(view.getByText(EXPLORER_LABELS.outgoingEmpty)).toBeTruthy(),
  );
  expect(queryCount).toBe(2);
});

test("surfaces a durable-write query failure", async () => {
  const documentQueries = {
    listPendingWrites: async () => {
      throw new Error("database unavailable");
    },
  } as unknown as ContainerDocumentQueries;
  const view = render(
    <ExplorerOutgoingPanel
      billingBlockedOrganizationId={null}
      dbReady
      documentQueries={documentQueries}
      domainScope={createDomainScope()}
      isAuthenticated={true}
      nodes={[ARCHIVE_NODE]}
      online={true}
      openContainerInfoRoute={() => undefined}
      openDocument={() => undefined}
      openWriteQueueEntryRoute={() => undefined}
      organizationNamesById={new Map()}
      selectedEntryKey={null}
      uploadManager={uploadManager()}
    />,
  );

  expect(
    await view.findByText(EXPLORER_LABELS.writeQueueFailedToLoad),
  ).toBeTruthy();
  expect(view.getByRole("alert")).toBeTruthy();
  expect(view.getByText("database unavailable")).toBeTruthy();
});

test("a scope switch never shows the previous scope's late rows", async () => {
  const pendingQueries = (
    calls: Array<(items: ReadonlyArray<PendingWriteQueueItem>) => void>,
  ) =>
    ({
      listPendingWrites: () =>
        new Promise<ReadonlyArray<PendingWriteQueueItem>>((resolve) => {
          calls.push(resolve);
        }),
    }) as unknown as ContainerDocumentQueries;
  const previousCalls: Array<
    (items: ReadonlyArray<PendingWriteQueueItem>) => void
  > = [];
  const nextCalls: Array<
    (items: ReadonlyArray<PendingWriteQueueItem>) => void
  > = [];
  const previousQueries = pendingQueries(previousCalls);
  const nextQueries = pendingQueries(nextCalls);
  const previousScope = createDomainScope();
  const nextScope = createDomainScope();

  const view = renderPanelLoader(previousQueries, previousScope);
  expect(previousCalls).toHaveLength(1);

  // The domain scope rotates (org switch, logout) while the previous scope's
  // scan is still pending: the new scope is read at once.
  view.rerender(
    <ExplorerOutgoingPanel
      billingBlockedOrganizationId={null}
      dbReady
      documentQueries={nextQueries}
      domainScope={nextScope}
      isAuthenticated={true}
      nodes={[ARCHIVE_NODE]}
      online={true}
      openContainerInfoRoute={() => undefined}
      openDocument={() => undefined}
      openWriteQueueEntryRoute={() => undefined}
      organizationNamesById={new Map()}
      selectedEntryKey={null}
      uploadManager={uploadManager()}
    />,
  );
  expect(nextCalls).toHaveLength(1);

  // The previous scope's late rows never reach the panel, and it is not
  // scanned again.
  await act(async () => {
    previousCalls[0]?.([item()]);
  });
  expect(
    view.queryByRole("button", { name: "Open object: Offline note" }),
  ).toBeNull();
  expect(view.getByText(EXPLORER_LABELS.writeQueueLoading)).toBeTruthy();

  await act(async () => {
    nextCalls[0]?.([]);
  });
  await waitFor(() =>
    expect(view.getByText(EXPLORER_LABELS.outgoingEmpty)).toBeTruthy(),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
  });
  expect(previousCalls).toHaveLength(1);
  expect(nextCalls).toHaveLength(1);
});

test("reloads a settled write while another sync lane remains active", async () => {
  let queryCount = 0;
  let pendingItems: ReadonlyArray<PendingWriteQueueItem> = [item()];
  const domainScope = createDomainScope();
  const documentQueries = {
    listPendingWrites: async () => {
      queryCount += 1;
      return pendingItems;
    },
  } as unknown as ContainerDocumentQueries;
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const activeUpload = coordinator.beginUploadLane("write-queue-active-upload");
  const lane = coordinator.registerLane("write-queue-settlement-test", {
    run: async () => {
      pendingItems = [];
    },
  });
  const view = renderPanelLoader(documentQueries, domainScope);

  expect(
    await view.findByRole("button", { name: "Open object: Offline note" }),
  ).toBeTruthy();
  await act(async () => {
    lane.requestSync();
  });

  try {
    await waitFor(() => {
      expect(queryCount).toBeGreaterThanOrEqual(2);
      expect(view.getByText(EXPLORER_LABELS.outgoingEmpty)).toBeTruthy();
    });
    const snapshot = getDomainSyncCoordinatorSnapshot(domainScope);
    expect(snapshot.hasPendingWork).toBe(true);
    expect(
      snapshot.lanes.find(
        (snapshotLane) => snapshotLane.key === "write-queue-active-upload",
      )?.running,
    ).toBe(true);
  } finally {
    await act(async () => {
      activeUpload.complete();
    });
  }
});

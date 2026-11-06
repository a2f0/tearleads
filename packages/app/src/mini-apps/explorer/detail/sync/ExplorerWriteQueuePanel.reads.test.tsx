import { afterEach, expect, test } from "bun:test";
import type {
  ContainerDocumentQueries,
  PendingWriteQueueItem,
} from "@tearleads/client-sdk";
import {
  createDomainScope,
  getDomainSyncCoordinatorSnapshot,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import {
  ARCHIVE_NODE,
  item,
} from "../../../../../test/helpers/explorer/syncPanelFixtures";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerWriteQueuePanel } from "./ExplorerWriteQueuePanel";

afterEach(() => cleanup());

function renderPanelLoader(
  documentQueries: ContainerDocumentQueries,
  domainScope = createDomainScope(),
) {
  return render(
    <ExplorerWriteQueuePanel
      billingBlockedOrganizationId={null}
      documentListRevision={0}
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
    />,
  );
}

test("coalesces a revision-bump burst and keeps stale rows while re-reading", async () => {
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
  const panelWithRevision = (documentListRevision: number) => (
    <ExplorerWriteQueuePanel
      billingBlockedOrganizationId={null}
      documentListRevision={documentListRevision}
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
    />
  );

  const view = render(panelWithRevision(0));
  expect(queryCount).toBe(1);

  // A burst of revision bumps while the first scan is still pending must queue
  // exactly one re-read, not one heavy scan per bump.
  view.rerender(panelWithRevision(1));
  view.rerender(panelWithRevision(2));
  view.rerender(panelWithRevision(3));
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

  await waitFor(() => expect(queryCount).toBe(2));
  await act(async () => {
    resolvers[1]?.([]);
  });

  await waitFor(() =>
    expect(view.getByText(EXPLORER_LABELS.writeQueueEmpty)).toBeTruthy(),
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
    <ExplorerWriteQueuePanel
      billingBlockedOrganizationId={null}
      documentListRevision={0}
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
    />,
  );

  expect(
    await view.findByText(EXPLORER_LABELS.writeQueueFailedToLoad),
  ).toBeTruthy();
  expect(view.getByRole("alert")).toBeTruthy();
  expect(view.getByText("database unavailable")).toBeTruthy();
});

test("drops a replaced documentQueries' reads and re-reads the new one", async () => {
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
  const domainScope = createDomainScope();
  const panelWith = (documentQueries: ContainerDocumentQueries) => (
    <ExplorerWriteQueuePanel
      billingBlockedOrganizationId={null}
      documentListRevision={0}
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
    />
  );

  const view = render(panelWith(previousQueries));
  expect(previousCalls).toHaveLength(1);

  // The database scope is replaced (org switch, logout) while the previous
  // scope's scan is still pending: the new scope is read at once.
  view.rerender(panelWith(nextQueries));
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
    expect(view.getByText(EXPLORER_LABELS.writeQueueEmpty)).toBeTruthy(),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
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
      expect(view.getByText(EXPLORER_LABELS.writeQueueEmpty)).toBeTruthy();
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

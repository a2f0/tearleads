import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  createDomainScope,
  type DomainScope,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as AppNavigationProvider from "../../navigation/AppNavigationProvider";
import type { RuntimeSnapshot } from "../../providers/sdk/TearleadsProvider";
import * as TearleadsProvider from "../../providers/sdk/TearleadsProvider";
import { SyncStatusPopoverContent } from "./SyncStatusPopoverContent";
import type { SyncStatusResult } from "./useSyncStatus";

const scopes: DomainScope[] = [];
const restores: Array<() => void> = [];

afterEach(() => {
  cleanup();
  for (const restore of restores.splice(0)) restore();
  for (const scope of scopes.splice(0))
    getOrCreateDomainSyncCoordinator(scope).dispose();
});

const WAITING: SyncStatusResult = {
  billingBlock: null,
  lanes: { failed: 0, firstError: null, running: 0 },
  pausedOrganizationCount: 0,
  pendingWriteCount: 2,
  queueReadFailed: false,
  status: "pending",
  title: "2 changes not yet synced",
};

const QUERIES = {
  listPendingDownloads: async () => [],
} as unknown as ContainerDocumentQueries;

function mountRuntime(input: {
  dbReady: boolean;
  isAuthenticated: boolean;
  online: boolean;
}) {
  const domainScope = createDomainScope();
  scopes.push(domainScope);
  const runtime = {
    auth: { isAuthenticated: input.isAuthenticated },
    infra: { dbStatus: input.dbReady ? "ready" : "opening" },
    state: { domainScope, online: input.online },
  } as unknown as RuntimeSnapshot;
  const openMiniApp = mock(() => {});
  const spies = [
    spyOn(TearleadsProvider, "useTearleadsRuntime").mockReturnValue(runtime),
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      containerContents: { documentQueries: () => QUERIES },
    } as unknown as ReturnType<typeof TearleadsProvider.useTearleads>),
    spyOn(AppNavigationProvider, "useAppNavigationActions").mockReturnValue({
      openMiniApp,
    } as unknown as ReturnType<
      typeof AppNavigationProvider.useAppNavigationActions
    >),
  ];
  restores.push(() => {
    for (const spy of spies) spy.mockRestore();
  });
  const close = mock(() => {});
  const view = render(
    <SyncStatusPopoverContent close={close} sync={WAITING} />,
  );
  return { close, domainScope, openMiniApp, view };
}

test("Sync now requests every lane of the runtime's scope, and links open their views", async () => {
  const { close, domainScope, openMiniApp, view } = mountRuntime({
    dbReady: true,
    isAuthenticated: true,
    online: true,
  });
  const run = mock(async () => {});
  getOrCreateDomainSyncCoordinator(domainScope).registerLane("documents:note", {
    run,
  });

  fireEvent.click(view.getByRole("button", { name: "Sync now" }));
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect(close).toHaveBeenCalledTimes(1);

  fireEvent.click(view.getByRole("button", { name: "View write queue" }));
  expect(openMiniApp).toHaveBeenCalledWith({
    appId: "explorer",
    pathSegments: ["outgoing"],
  });
});

for (const [label, blocked] of [
  ["offline", { online: false }],
  ["signed out", { isAuthenticated: false }],
  ["with the database closed", { dbReady: false }],
] as const) {
  test(`Sync now is not offered ${label}`, () => {
    const { view } = mountRuntime({
      dbReady: true,
      isAuthenticated: true,
      online: true,
      ...blocked,
    });
    expect(view.queryByRole("button", { name: "Sync now" })).toBeNull();
    expect(view.getByRole("button", { name: "View write queue" })).toBeTruthy();
  });
}

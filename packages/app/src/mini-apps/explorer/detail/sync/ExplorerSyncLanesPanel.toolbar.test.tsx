import { afterEach, expect, test } from "bun:test";
import type { DomainScope } from "@tearleads/client-sdk";
import {
  createDomainScope,
  getOrCreateDomainSyncCoordinator,
  requestAllDomainSyncLanes,
  waitForDomainSyncCoordinatorToSettle,
} from "@tearleads/client-sdk";
import {
  useWindowRefreshMenuItemValue,
  WindowMenuProvider,
} from "@tearleads/windowing";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ExplorerSyncLanesPanel } from "./ExplorerSyncLanesPanel";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

function ToolbarProbe() {
  const refresh = useWindowRefreshMenuItemValue();

  return (
    <div aria-label="Toolbar" role="toolbar">
      {refresh ? (
        <button
          aria-label={refresh.label}
          disabled={refresh.disabled}
          type="button"
          onClick={refresh.onClick}
        />
      ) : null}
    </div>
  );
}

function renderSyncLanesPanelContainer(input: { domainScope: DomainScope }) {
  return render(
    <WindowMenuProvider>
      <ExplorerSyncLanesPanel
        domainScope={input.domainScope}
        embedded
        onBackToSelectionRoute={() => undefined}
        onOpenLaneDetail={() => undefined}
        selectedLaneKey={null}
      />
      <ToolbarProbe />
    </WindowMenuProvider>,
  );
}

test("ExplorerSyncLanesPanel triggers a manual sync from Refresh", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let runCount = 0;
  coordinator.registerLane("lane-a", {
    run: async () => {
      runCount += 1;
    },
  });

  const view = renderSyncLanesPanelContainer({ domainScope });

  const button = await view.findByRole("button", {
    name: "Refresh",
  });
  fireEvent.click(button);

  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      quietMs: 0,
      timeoutMs: 1_000,
    }),
  ).toBe(true);
  expect(runCount).toBe(1);
});

test("ExplorerSyncLanesPanel keeps Refresh enabled while syncing", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let releaseLane: () => void = () => undefined;
  coordinator.registerLane("lane-a", {
    run: () =>
      new Promise<void>((resolve) => {
        releaseLane = resolve;
      }),
  });
  // Kick off a sync that stays in flight so the snapshot reports pending work.
  requestAllDomainSyncLanes(domainScope);

  const view = renderSyncLanesPanelContainer({ domainScope });

  const button = (await view.findByRole("button", {
    name: "Refresh",
  })) as HTMLButtonElement;
  // The action stays ENABLED with work in flight: re-requesting is idempotent,
  // and a queue that looks stuck with pending work is exactly when the manual
  // escape hatch must remain usable (issue #1672).
  await waitFor(() => {
    expect(button.disabled).toBe(false);
  });

  releaseLane();
  await waitForDomainSyncCoordinatorToSettle(domainScope, {
    quietMs: 0,
    timeoutMs: 1_000,
  });
});

import { afterEach, expect, test } from "bun:test";
import type { DomainScope } from "@tearleads/client-sdk";
import {
  createDomainScope,
  getOrCreateDomainSyncCoordinator,
  requestAllDomainSyncLanes,
  waitForDomainSyncCoordinatorToSettle,
} from "@tearleads/client-sdk";
import {
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "@tearleads/windowing";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerSyncLanesPanel } from "./ExplorerSyncLanesPanel";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

// Surface the registered title-bar actions as buttons for toolbar assertions.
function ToolbarProbe() {
  const actions = useWindowTitleBarActions();

  return (
    <div aria-label="Toolbar" role="toolbar">
      {actions.map((action) => (
        <button
          aria-label={action.label}
          disabled={action.disabled}
          key={action.id}
          type="button"
          onClick={action.onClick}
        />
      ))}
    </div>
  );
}

function renderSyncLanesPanelContainer(input: {
  domainScope: DomainScope;
  selectedLaneKey?: string | null | undefined;
}) {
  return render(
    <WindowMenuProvider>
      <ExplorerSyncLanesPanel
        domainScope={input.domainScope}
        embedded
        onBackToSelectionRoute={() => undefined}
        onOpenLaneDetail={() => undefined}
        selectedLaneKey={input.selectedLaneKey ?? null}
      />
      <ToolbarProbe />
    </WindowMenuProvider>,
  );
}

test("ExplorerSyncLanesPanel triggers a manual sync from the toolbar action", async () => {
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
    name: EXPLORER_LABELS.syncLanesSyncNowAction,
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

test("ExplorerSyncLanesPanel keeps the toolbar action enabled while syncing", async () => {
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
    name: EXPLORER_LABELS.syncLanesSyncNowAction,
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

test("ExplorerSyncLanesPanel drops the toolbar action in lane detail", async () => {
  const view = renderSyncLanesPanelContainer({
    domainScope: createDomainScope(),
    selectedLaneKey: "documents:local-1",
  });

  // The lane-detail header renders, but no manual-sync toolbar action registers.
  await view.findByText(EXPLORER_LABELS.syncLanesDetailTitle);
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.syncLanesSyncNowAction,
    }),
  ).toBeNull();
});

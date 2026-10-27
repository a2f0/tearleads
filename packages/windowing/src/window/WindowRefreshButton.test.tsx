import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { LauncherNavigationProvider } from "../launcher/LauncherNavigationProvider";
import { RoutedPaneAppBar } from "../routed/RoutedPaneAppBar";
import { TEST_LAUNCHER } from "../routed/routedPane.testUtils";
import {
  useWindowRefreshMenuItem,
  useWindowToolbarReservation,
  WindowMenuProvider,
} from "./WindowMenuContext";
import { WindowStateProvider } from "./WindowStateProvider";
import { WindowToolBar } from "./WindowToolBar";

afterEach(cleanup);

function RefreshRegistration({
  disabled,
  onRefresh,
  refreshing,
}: {
  disabled: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  useWindowRefreshMenuItem({ disabled, onRefresh, refreshing });
  return null;
}

test("refresh alone reserves a window toolbar until explicitly released", () => {
  function Reservation({ reserve }: { reserve: boolean }) {
    useWindowToolbarReservation(reserve);
    return null;
  }
  function Harness({ show, reserve }: { show: boolean; reserve: boolean }) {
    return (
      <WindowMenuProvider>
        <Reservation reserve={reserve} />
        {show && (
          <RefreshRegistration
            disabled={false}
            refreshing={false}
            onRefresh={() => undefined}
          />
        )}
        <WindowToolBar showHistoryBack={false} />
      </WindowMenuProvider>
    );
  }

  const view = render(<Harness show={false} reserve={false} />);
  expect(view.queryByRole("toolbar")).toBeNull();
  view.rerender(<Harness show reserve={false} />);
  expect(view.getByRole("button", { name: "Refresh" })).toBeTruthy();
  view.rerender(<Harness show={false} reserve={false} />);
  expect(view.queryByRole("button", { name: "Refresh" })).toBeNull();
  expect(view.getByRole("toolbar")).toBeTruthy();
  view.rerender(<Harness show={false} reserve />);
  view.rerender(<Harness show={false} reserve={false} />);
  expect(view.queryByRole("toolbar")).toBeNull();
});

for (const mode of ["windowed", "tablet"] as const) {
  test(`${mode} toolbar shares refresh callback and busy state`, () => {
    let calls = 0;
    const onRefresh = () => {
      calls += 1;
    };
    const content = (disabled: boolean, refreshing: boolean) => (
      <WindowStateProvider>
        <LauncherNavigationProvider definition={TEST_LAUNCHER} mode="routed">
          <WindowMenuProvider>
            <RefreshRegistration
              disabled={disabled}
              onRefresh={onRefresh}
              refreshing={refreshing}
            />
            {mode === "windowed" ? (
              <WindowToolBar />
            ) : (
              <RoutedPaneAppBar
                activeAppId="explorer"
                hasSidebar={false}
                onToggleSidebar={() => undefined}
                sidebarExpanded={false}
                tier="tablet"
              />
            )}
          </WindowMenuProvider>
        </LauncherNavigationProvider>
      </WindowStateProvider>
    );
    const view = render(content(false, false));
    const toolbar = within(view.getByRole("toolbar", { name: "Toolbar" }));
    fireEvent.click(toolbar.getByRole("button", { name: "Refresh" }));
    expect(calls).toBe(1);

    view.rerender(content(false, true));
    const busy = toolbar.getByRole("button", {
      name: "Refreshing...",
    }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(calls).toBe(1);

    view.rerender(content(true, false));
    expect(
      (toolbar.getByRole("button", { name: "Refresh" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    view.rerender(content(false, false));
    fireEvent.click(toolbar.getByRole("button", { name: "Refresh" }));
    expect(calls).toBe(2);
  });
}

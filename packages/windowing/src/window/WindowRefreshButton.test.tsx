import { afterEach, expect, jest, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
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

afterEach(() => {
  jest.useRealTimers();
  cleanup();
});

interface RefreshRegistrationProps {
  disabled: boolean;
  onCancel?: (() => void) | undefined;
  onRefresh: () => void;
  refreshing: boolean;
}

function RefreshRegistration({
  disabled,
  onCancel,
  onRefresh,
  refreshing,
}: RefreshRegistrationProps) {
  useWindowRefreshMenuItem({ disabled, onCancel, onRefresh, refreshing });
  return null;
}

function toolbarContent(
  mode: "windowed" | "tablet",
  registration: RefreshRegistrationProps,
) {
  return (
    <WindowStateProvider>
      <LauncherNavigationProvider definition={TEST_LAUNCHER} mode="routed">
        <WindowMenuProvider>
          <RefreshRegistration {...registration} />
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
  test(`${mode} toolbar shares refresh callback and busy spinner`, () => {
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
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.querySelector(".window-refresh-spinner")).not.toBeNull();
    fireEvent.click(busy);
    expect(calls).toBe(1);

    view.rerender(content(true, false));
    const idle = toolbar.getByRole("button", {
      name: "Refresh",
    }) as HTMLButtonElement;
    expect(idle.disabled).toBe(true);
    // Disabled without a refresh running greys out but does not spin.
    expect(idle.getAttribute("aria-busy")).toBe("false");
    expect(idle.querySelector(".window-refresh-spinner")).toBeNull();
    view.rerender(content(false, false));
    fireEvent.click(toolbar.getByRole("button", { name: "Refresh" }));
    expect(calls).toBe(2);
  });
}

for (const mode of ["windowed", "tablet"] as const) {
  test(`${mode} toolbar offers Cancel Refresh while a cancellable refresh runs`, () => {
    let refreshes = 0;
    let cancels = 0;
    const registration = (refreshing: boolean, cancellable: boolean) => ({
      disabled: refreshing,
      onCancel: cancellable
        ? () => {
            cancels += 1;
          }
        : undefined,
      onRefresh: () => {
        refreshes += 1;
      },
      refreshing,
    });
    const view = render(toolbarContent(mode, registration(true, true)));
    const toolbar = within(view.getByRole("toolbar", { name: "Toolbar" }));
    const busy = toolbar.getByRole("button", {
      name: "Refreshing...",
    }) as HTMLButtonElement;
    // Reachable for its context menu, but inert to a click.
    expect(busy.disabled).toBe(false);
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(busy);
    expect(refreshes).toBe(0);

    fireEvent.contextMenu(busy, { clientX: 10, clientY: 10 });
    fireEvent.click(view.getByRole("button", { name: "Cancel Refresh" }));
    expect(cancels).toBe(1);
    expect(view.queryByRole("button", { name: "Cancel Refresh" })).toBeNull();

    // A refresh that settles with its menu open takes the menu with it, and
    // the next refresh does not reopen it.
    fireEvent.contextMenu(busy, { clientX: 10, clientY: 10 });
    view.rerender(toolbarContent(mode, registration(false, true)));
    expect(view.queryByRole("button", { name: "Cancel Refresh" })).toBeNull();
    view.rerender(toolbarContent(mode, registration(true, true)));
    expect(view.queryByRole("button", { name: "Cancel Refresh" })).toBeNull();

    // A refresh that cannot be cancelled stays disabled, with no menu.
    view.rerender(toolbarContent(mode, registration(true, false)));
    const plain = toolbar.getByRole("button", {
      name: "Refreshing...",
    }) as HTMLButtonElement;
    expect(plain.disabled).toBe(true);
    fireEvent.contextMenu(plain, { clientX: 10, clientY: 10 });
    expect(view.queryByRole("button", { name: "Cancel Refresh" })).toBeNull();
  });
}

test("a touch long press on a running refresh offers Cancel Refresh", () => {
  let cancels = 0;
  jest.useFakeTimers();
  const view = render(
    toolbarContent("windowed", {
      disabled: true,
      onCancel: () => {
        cancels += 1;
      },
      onRefresh: () => undefined,
      refreshing: true,
    }),
  );
  const busy = view.getByRole("button", { name: "Refreshing..." });

  fireEvent.pointerDown(busy, { pointerType: "touch", clientX: 5, clientY: 5 });
  act(() => {
    jest.advanceTimersByTime(500);
  });
  // The click the browser synthesizes from the release is swallowed; the
  // next tap lands on the menu.
  fireEvent.pointerUp(busy, { pointerType: "touch", clientX: 5, clientY: 5 });
  fireEvent.click(busy);
  fireEvent.click(view.getByRole("button", { name: "Cancel Refresh" }));
  expect(cancels).toBe(1);
});

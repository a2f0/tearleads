import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef, type MouseEvent, useMemo } from "react";
import { LauncherNavigationProvider } from "../launcher/LauncherNavigationProvider";
import { RoutedPaneAppBar } from "../routed/RoutedPaneAppBar";
import { TEST_LAUNCHER } from "../routed/routedPane.testUtils";
import {
  useWindowTitleBarAction,
  WindowMenuProvider,
} from "./WindowMenuContext";
import { WindowStateProvider } from "./WindowStateProvider";
import { WindowToolBar } from "./WindowToolBar";

afterEach(cleanup);

for (const mode of ["windowed", "tablet"] as const) {
  test(`${mode} forwards popup anchor, expanded state and mousedown`, () => {
    const anchor = createRef<HTMLButtonElement>();
    let mouseDowns = 0;
    let outsideMouseDowns = 0;
    const onMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
      mouseDowns += 1;
      event.stopPropagation();
    };
    function Action({ expanded }: { expanded: boolean }) {
      const buttonProps = useMemo(
        () => ({ "aria-expanded": expanded, onMouseDown, ref: anchor }),
        [expanded],
      );
      useWindowTitleBarAction({
        buttonProps,
        icon: "…",
        id: "popup",
        label: "Actions",
        onClick: () => undefined,
      });
      return null;
    }
    function Harness({ expanded }: { expanded: boolean }) {
      return (
        <WindowStateProvider>
          <LauncherNavigationProvider definition={TEST_LAUNCHER} mode="routed">
            <WindowMenuProvider>
              <Action expanded={expanded} />
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
    const onOutsideMouseDown = () => {
      outsideMouseDowns += 1;
    };
    document.addEventListener("mousedown", onOutsideMouseDown);
    try {
      const view = render(<Harness expanded={false} />);
      const button = view.getByRole("button", {
        name: "Actions",
      }) as HTMLButtonElement;
      expect(anchor.current).toBe(button);
      expect(button.getAttribute("aria-expanded")).toBe("false");
      fireEvent.mouseDown(button);
      expect(mouseDowns).toBe(1);
      expect(outsideMouseDowns).toBe(0);
      view.rerender(<Harness expanded />);
      expect(anchor.current).toBe(button);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      view.unmount();
      expect(anchor.current).toBeNull();
    } finally {
      document.removeEventListener("mousedown", onOutsideMouseDown);
    }
  });
}

import { afterEach, expect, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { RoutedPaneSidebar } from "../routed/RoutedPaneSidebar";
import { captureResizeObservers } from "../window/layout.testUtils";
import { WindowSidebar } from "../window/WindowSidebar";
import { SidebarResizeHandle } from "./SidebarResize";

afterEach(cleanup);

test("legacy resize handles keep a valid range without an explicit maximum", () => {
  const view = render(
    <SidebarResizeHandle
      className="legacy"
      currentWidth={900}
      onKeyDown={() => {}}
      onPointerDown={() => {}}
    />,
  );
  expect(view.getByRole("separator").getAttribute("aria-valuemax")).toBe("900");
});

for (const mode of ["window", "tablet"] as const) {
  test(`${mode} sidebar uses 90% of its available width and follows layout changes`, () => {
    let availableWidth = 1_001;
    const observers = captureResizeObservers();
    const bounds = spyOn(
      HTMLElement.prototype,
      "getBoundingClientRect",
    ).mockImplementation(function (this: HTMLElement) {
      const isContainer = this.matches(
        ".window-sidebar-layout, .routed-pane-appbar",
      );
      return new DOMRect(0, 0, isContainer ? availableWidth : 0, 600);
    });

    try {
      const view = render(
        mode === "window" ? (
          <WindowSidebar sidebar="Sidebar">Content</WindowSidebar>
        ) : (
          <section className="routed-pane">
            <header className="routed-pane-appbar">App bar</header>
            <RoutedPaneSidebar onClose={() => {}} tier="tablet">
              Sidebar
            </RoutedPaneSidebar>
            <main>Content</main>
          </section>
        ),
      );
      const handle = view.getByRole("separator", { name: "Resize sidebar" });
      const sidebar = view.container.querySelector<HTMLElement>(
        mode === "window" ? ".window-sidebar" : ".routed-pane-sidebar",
      );
      expect(handle.getAttribute("aria-valuemax")).toBe("900");

      fireEvent.pointerDown(handle, {
        button: 0,
        clientX: 224,
        isPrimary: true,
        pointerId: 1,
        pointerType: mode === "tablet" ? "touch" : "mouse",
      });
      fireEvent.pointerMove(document, { clientX: 2_000, pointerId: 1 });
      expect(sidebar?.style.width).toBe("900px");
      expect(handle.getAttribute("aria-valuenow")).toBe("900");

      // Window resizing or expanding the tablet launcher reduces available space,
      // including during an active drag, without needing another pointer move.
      availableWidth = 600;
      act(() => observers.fire());
      expect(sidebar?.style.width).toBe("540px");
      expect(handle.getAttribute("aria-valuemax")).toBe("540");
      expect(handle.getAttribute("aria-valuenow")).toBe("540");
      availableWidth = 1_001;
      act(() => observers.fire());
      expect(sidebar?.style.width).toBe("900px");
      availableWidth = 600;
      act(() => observers.fire());
      fireEvent.pointerMove(document, { clientX: 2_100, pointerId: 1 });
      expect(sidebar?.style.width).toBe("540px");
      fireEvent.pointerUp(document, { pointerId: 1 });

      fireEvent.keyDown(handle, { key: "ArrowLeft" });
      expect(sidebar?.style.width).toBe("530px");
      fireEvent.keyDown(handle, { key: "End" });
      expect(sidebar?.style.width).toBe("540px");
      fireEvent.keyDown(handle, { key: "ArrowRight" });
      expect(sidebar?.style.width).toBe("540px");

      // Hiding a pane must not destroy its last usable bounds.
      availableWidth = 0;
      act(() => observers.fire());
      expect(handle.getAttribute("aria-valuemax")).toBe("540");

      availableWidth = 1_200;
      act(() => observers.fire());
      fireEvent.keyDown(handle, { key: "End" });
      expect(sidebar?.style.width).toBe("1080px");
      fireEvent.keyDown(handle, { key: "Home" });
      expect(sidebar?.style.width).toBe("80px");
      view.unmount();
    } finally {
      bounds.mockRestore();
      observers.restore();
    }
  });
}

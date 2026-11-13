import { afterEach, expect, test } from "bun:test";
import {
  MiniAppRouteSegmentsProvider,
  useWindowActions,
  useWindowStateData,
  Window,
  type WindowEntry,
  WindowStateProvider,
} from "@tearleads/windowing";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { type ComponentType, type PropsWithChildren, useMemo } from "react";
import { DisplayPropertiesApp } from "../../mini-apps/display-properties/DisplayPropertiesApp";
import type { MiniAppId } from "../../mini-apps/types";
import { DiagnosticsProvider } from "../../providers/logging/DiagnosticsProvider";
import { MiniAppBoundary } from "./MiniAppBoundary";

afterEach(cleanup);

function Draft() {
  return <textarea aria-label="Draft" />;
}

function Desktop({
  appId,
  component = Draft,
}: {
  appId: MiniAppId;
  component?: ComponentType;
}) {
  const { create } = useWindowActions();
  const { windows } = useWindowStateData();
  const Boundary = useMemo(
    () =>
      function Boundary({
        children,
        entry,
      }: PropsWithChildren<{ entry: WindowEntry }>) {
        return (
          <MiniAppRouteSegmentsProvider
            appId={appId}
            canGoBack={false}
            goBack={() => {}}
            pathSegments={[]}
            setPathSegments={() => {}}
            windowId={entry.id}
          >
            <MiniAppBoundary appId={appId}>{children}</MiniAppBoundary>
          </MiniAppRouteSegmentsProvider>
        );
      },
    [appId],
  );
  return (
    <>
      <button
        type="button"
        onClick={() =>
          create("Test window", 900, 650, component, {
            appId,
            size: { height: 900, width: 1200 },
          })
        }
      >
        Open
      </button>
      <div data-testid="surface">
        {windows.map((entry) => (
          <Window
            ContentBoundary={Boundary}
            key={entry.id}
            windowId={entry.id}
          />
        ))}
      </div>
    </>
  );
}

function rect(element: Element, width: number, height: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => DOMRect.fromRect({ height, width }),
  });
}

// Exercise MiniAppBoundary in Window's real ContentBoundary slot, not a mocked
// size setter. Geometry changes must neither remount nor discard the editor.
test.each(["contacts", "notes", "root"] as const)(
  "%s fits inside its desktop and restores from maximized without losing a draft",
  (appId) => {
    const view = render(
      <DiagnosticsProvider value={undefined}>
        <WindowStateProvider>
          <Desktop appId={appId} />
        </WindowStateProvider>
      </DiagnosticsProvider>,
    );
    const surface = view.getByTestId("surface");
    Object.defineProperties(surface, {
      clientWidth: { configurable: true, value: 1100 },
      clientHeight: { configurable: true, value: 800 },
    });
    fireEvent.click(view.getByRole("button", { name: "Open" }));
    const window = view.getByRole("region", { name: "Test window" });
    expect(window.style.width).toBe("1200px");
    expect(window.style.height).toBe("900px");
    const pane = window.querySelector<HTMLElement>(
      ".window-body-content-scroll",
    );
    if (!pane) throw new Error("Missing content scroll pane");
    rect(window, 1200, 900);
    rect(pane, 1180, 840);
    pane.style.padding = "16px";
    const draft = view.getByRole("textbox", { name: "Draft" });
    fireEvent.input(draft, { target: { value: "Keep this unsaved text" } });

    const fitWindow = () => {
      fireEvent.click(within(window).getByRole("menuitem", { name: "View" }));
      fireEvent.click(
        within(window).getByRole("menuitem", { name: "Fit to Content" }),
      );
    };
    fitWindow();
    const width = Number.parseFloat(window.style.width);
    const height = Number.parseFloat(window.style.height);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThan(1200);
    expect(height).toBeGreaterThan(0);
    expect(height).toBeLessThan(900);
    expect(Number.parseFloat(window.style.left) + width).toBeLessThanOrEqual(
      1100,
    );
    expect(Number.parseFloat(window.style.top) + height).toBeLessThanOrEqual(
      800,
    );

    fireEvent.click(
      within(window).getByRole("button", { name: "Toggle maximize window" }),
    );
    expect(window.classList.contains("window--maximized")).toBe(true);
    fitWindow();
    expect(window.classList.contains("window--maximized")).toBe(false);
    expect(Number.parseFloat(window.style.width)).toBe(width);
    expect(Number.parseFloat(window.style.height)).toBe(height);
    expect(view.getByRole("textbox", { name: "Draft" })).toBe(draft);
    expect((draft as HTMLTextAreaElement).value).toBe("Keep this unsaved text");
  },
);

test("display properties fits measured fractional content without automatic resizing", () => {
  const originalObserver = globalThis.ResizeObserver;
  const observers = new Map<Element, () => void>();
  globalThis.ResizeObserver = class implements ResizeObserver {
    private readonly targets = new Set<Element>();
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.targets.add(target);
      observers.set(target, () => this.callback([], this));
    }
    unobserve(target: Element) {
      this.targets.delete(target);
      observers.delete(target);
    }
    disconnect() {
      for (const target of this.targets) this.unobserve(target);
    }
  };
  try {
    const view = render(
      <DiagnosticsProvider value={undefined}>
        <WindowStateProvider>
          <Desktop
            appId="display-properties"
            component={DisplayPropertiesApp}
          />
        </WindowStateProvider>
      </DiagnosticsProvider>,
    );
    const surface = view.getByTestId("surface");
    Object.defineProperties(surface, {
      clientWidth: { configurable: true, value: 1100 },
      clientHeight: { configurable: true, value: 800 },
    });
    fireEvent.click(view.getByRole("button", { name: "Open" }));
    const window = view.getByRole("region", { name: "Test window" });
    const pane = window.querySelector<HTMLElement>(
      ".window-body-content-scroll",
    );
    const content = window.querySelector<HTMLElement>(
      ".app-display-properties",
    );
    if (!pane || !content) throw new Error("Missing settings content");
    rect(window, 1200, 900);
    rect(pane, 1180, 840);
    pane.style.padding = "16px";
    const resize = observers.get(content);
    if (!resize) throw new Error("Settings content is not observed");

    fireEvent.click(within(window).getByRole("menuitem", { name: "View" }));
    expect(
      within(window).queryByRole("menuitem", { name: "Fit to Content" }),
    ).toBeNull();
    fireEvent.click(within(window).getByRole("menuitem", { name: "View" }));

    // The DOM's integer offsets lose the fractional part of the layout size.
    Object.defineProperties(content, {
      offsetWidth: { configurable: true, value: 420 },
      offsetHeight: { configurable: true, value: 252 },
    });
    rect(content, 420.25, 252.25);
    act(resize);
    expect(window.style.width).toBe("1200px");
    expect(window.style.height).toBe("900px");
    const fitWindow = () => {
      fireEvent.click(within(window).getByRole("menuitem", { name: "View" }));
      fireEvent.click(
        within(window).getByRole("menuitem", { name: "Fit to Content" }),
      );
    };
    fitWindow();
    // Content + 20×60 chrome + 32px padding, rounded up to avoid clipping.
    expect(window.style.width).toBe("473px");
    expect(window.style.height).toBe("345px");

    rect(content, 430.25, 282.25);
    act(resize);
    expect(window.style.width).toBe("473px");
    expect(window.style.height).toBe("345px");
    fitWindow();
    expect(window.style.width).toBe("483px");
    expect(window.style.height).toBe("375px");

    rect(content, 0, 0);
    act(resize);
    fitWindow();
    expect(window.style.width).toBe("483px");
    expect(window.style.height).toBe("375px");
    view.unmount();
    expect(observers.has(content)).toBe(false);
  } finally {
    cleanup();
    globalThis.ResizeObserver = originalObserver;
  }
});

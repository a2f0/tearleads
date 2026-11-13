import { afterEach, expect, test } from "bun:test";
import {
  MiniAppRouteSegmentsProvider,
  useWindowActions,
  useWindowStateData,
  Window,
  type WindowEntry,
  WindowStateProvider,
} from "@tearleads/windowing";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { type PropsWithChildren, useMemo } from "react";
import type { MiniAppId } from "../../mini-apps/types";
import { DiagnosticsProvider } from "../../providers/logging/DiagnosticsProvider";
import { MiniAppBoundary } from "./MiniAppBoundary";

afterEach(cleanup);

function Draft() {
  return <textarea aria-label="Draft" />;
}

function Desktop({ appId }: { appId: MiniAppId }) {
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
          create("Draft window", 900, 650, Draft, {
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

// Exercise the app's actual ContentBoundary inside a real Window, not a mocked
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
    const window = view.getByRole("region", { name: "Draft window" });
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

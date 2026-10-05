import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { useState } from "react";
import { useWindowContentSize } from "./CurrentWindowContext";
import { stubLayout } from "./layout.testUtils";
import { Window } from "./Window";
import {
  useWindowActions,
  useWindowStateData,
  type WindowPosition,
  type WindowSize,
  WindowStateProvider,
} from "./WindowStateProvider";
import { fitWindowGeometry, type WindowFitMetrics } from "./windowGeometry";

afterEach(cleanup);

const METRICS: WindowFitMetrics = {
  chrome: { height: 60, width: 20 },
  padding: { height: 32, width: 32 },
  scrollbar: { height: 15, width: 15 },
};
const SURFACE = { height: 800, width: 1000 };
const SURFACE_LAYOUT = {
  clientHeight: SURFACE.height,
  clientWidth: SURFACE.width,
};

describe("fitWindowGeometry", () => {
  test("sizes the window to its content, leaving room for a scrollbar", () => {
    expect(
      fitWindowGeometry({ height: 400, width: 500 }, METRICS, SURFACE, {
        x: 100,
        y: 50,
      }),
    ).toEqual({
      position: { x: 100, y: 50 },
      size: { height: 492, width: 567 },
    });
  });

  test("content taller than the surface fills its height", () => {
    expect(
      fitWindowGeometry({ height: 1000, width: 500 }, METRICS, SURFACE, {
        x: 100,
        y: 50,
      }),
    ).toEqual({
      position: { x: 100, y: 0 },
      size: { height: 800, width: 567 },
    });
  });

  test("content wider than the surface makes room for the sideways scrollbar", () => {
    expect(
      fitWindowGeometry({ height: 400, width: 1200 }, METRICS, SURFACE, {
        x: 100,
        y: 50,
      }),
    ).toEqual({
      position: { x: 0, y: 50 },
      size: { height: 507, width: 1000 },
    });
  });

  test("rounds up to whole pixels and keeps the minimum size", () => {
    const fractional = { ...METRICS, chrome: { height: 60.4, width: 20.2 } };
    expect(
      fitWindowGeometry({ height: 400, width: 500 }, fractional, SURFACE, {
        x: 0,
        y: 0,
      }).size,
    ).toEqual({ height: 493, width: 568 });
    expect(
      fitWindowGeometry({ height: 1, width: 1 }, METRICS, SURFACE, {
        x: 0,
        y: 0,
      }).size,
    ).toEqual({ height: 100, width: 200 });
  });
});

function PageContent() {
  const [size, setSize] = useState<WindowSize | undefined>({
    height: 400,
    width: 500,
  });
  useWindowContentSize(size);
  return (
    <button type="button" onClick={() => setSize(undefined)}>
      Withdraw size
    </button>
  );
}

function Desktop({ position }: { position: WindowPosition }) {
  const { windows } = useWindowStateData();
  const { create, toggleMaximize } = useWindowActions();
  const first = windows[0];

  return (
    <>
      <button
        type="button"
        onClick={() => create("Page", 0, 0, PageContent, { position })}
      >
        Open page
      </button>
      <button type="button" onClick={() => first && toggleMaximize(first.id)}>
        Toggle maximize
      </button>
      <output aria-label="committed geometry">
        {first
          ? JSON.stringify({ position: first.position, size: first.size })
          : ""}
      </output>
      <div data-testid="surface">
        {windows.map((entry) => (
          <Window key={entry.id} windowId={entry.id} />
        ))}
      </div>
    </>
  );
}

function stubRect(element: Element, size: WindowSize) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => DOMRect.fromRect(size),
  });
}

function openPage(position: WindowPosition = { x: 600, y: 500 }) {
  const view = render(
    <WindowStateProvider>
      <Desktop position={position} />
    </WindowStateProvider>,
  );
  stubLayout(view.getByTestId("surface"), SURFACE_LAYOUT);
  fireEvent.click(view.getByRole("button", { name: "Open page" }));
  const region = view.getByRole("region", { name: "Page" });
  const pane = region.querySelector<HTMLElement>(".window-body-content-scroll");
  if (!pane) throw new Error("Missing scroll pane");
  pane.style.padding = "16px";
  stubRect(region, { height: 300, width: 400 });
  stubRect(pane, { height: 240, width: 380 });
  stubLayout(pane, {
    clientHeight: 225,
    clientWidth: 365,
    offsetHeight: 240,
    offsetWidth: 380,
  });
  return { pane, region, view };
}

function openViewMenu(region: HTMLElement) {
  fireEvent.click(within(region).getByRole("menuitem", { name: "View" }));
}

function committedGeometry(view: ReturnType<typeof render>) {
  return JSON.parse(
    view.getByRole("status", { name: "committed geometry" }).textContent ??
      "{}",
  );
}

test("Fit to Content sizes the window to its content and keeps it on the surface", () => {
  const { pane, region, view } = openPage();

  openViewMenu(region);
  fireEvent.click(
    within(region).getByRole("menuitem", { name: "Fit to Content" }),
  );

  expect(committedGeometry(view)).toEqual({
    position: { x: 433, y: 308 },
    size: { height: 492, width: 567 },
  });
  expect(region.style.width).toBe("567px");
  expect(region.style.height).toBe("492px");
  expect(pane.style.overflow).toBe("");
});

test("Fit to Content restores a maximized window", () => {
  const { region, view } = openPage({ x: 0, y: 0 });
  fireEvent.click(view.getByRole("button", { name: "Toggle maximize" }));
  expect(region.classList.contains("window--maximized")).toBe(true);

  openViewMenu(region);
  fireEvent.click(
    within(region).getByRole("menuitem", { name: "Fit to Content" }),
  );

  expect(region.classList.contains("window--maximized")).toBe(false);
  expect(committedGeometry(view).size).toEqual({ height: 492, width: 567 });
});

test("the View menu offers Fit to Content only while the content has a size", () => {
  const { region, view } = openPage();

  fireEvent.click(view.getByRole("button", { name: "Withdraw size" }));
  openViewMenu(region);

  expect(
    within(region).queryByRole("menuitem", { name: "Fit to Content" }),
  ).toBeNull();
  expect(
    within(region).getByRole("menuitem", { name: "Resize Window" }),
  ).toBeTruthy();
});

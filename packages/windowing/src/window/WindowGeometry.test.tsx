import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { captureResizeObservers, stubLayout } from "./layout.testUtils";
import { Window } from "./Window";
import {
  useWindowActions,
  useWindowStateData,
  type WindowCreateOptions,
  WindowStateProvider,
} from "./WindowStateProvider";

afterEach(cleanup);

function GeometryProbe() {
  const { windows } = useWindowStateData();
  const entry = windows[0];
  return (
    <output aria-label="committed geometry">
      {entry
        ? JSON.stringify({ position: entry.position, size: entry.size })
        : ""}
    </output>
  );
}

function NotesContent() {
  return <p>notes</p>;
}

function DesktopHarness({ options }: { options: WindowCreateOptions }) {
  const { windows } = useWindowStateData();
  const { create, minimize, restore, setGeometry, toggleMaximize } =
    useWindowActions();
  const first = windows[0];

  return (
    <>
      <button
        type="button"
        onClick={() => create("Notes", 0, 0, NotesContent, options)}
      >
        Open notes
      </button>
      <button
        type="button"
        onClick={() =>
          first &&
          setGeometry(first.id, {
            position: { x: 500, y: 0 },
            size: { height: 100, width: 200 },
          })
        }
      >
        Restore layout
      </button>
      <button
        type="button"
        onClick={() =>
          first &&
          setGeometry(first.id, { position: first.position ?? { x: 0, y: 0 } })
        }
      >
        Clear size
      </button>
      <button type="button" onClick={() => first && minimize(first.id)}>
        Minimize notes
      </button>
      <button type="button" onClick={() => first && restore(first.id)}>
        Restore notes
      </button>
      <button type="button" onClick={() => first && toggleMaximize(first.id)}>
        Toggle maximize
      </button>
      <button
        type="button"
        onClick={() =>
          first && setGeometry(first.id, { position: { x: 300, y: 200 } })
        }
      >
        Move notes
      </button>
      <div data-testid="surface">
        {windows.map((entry) => (
          <Window key={entry.id} windowId={entry.id} />
        ))}
      </div>
    </>
  );
}

// The surface gets its size before the window opens, so the window's first
// layout clamps against it.
function renderDesktop(options: WindowCreateOptions = {}) {
  const view = render(
    <WindowStateProvider>
      <DesktopHarness options={options} />
      <GeometryProbe />
    </WindowStateProvider>,
  );
  stubLayout(view.getByTestId("surface"), {
    clientHeight: 600,
    clientWidth: 800,
  });
  fireEvent.click(view.getByRole("button", { name: "Open notes" }));
  const windowRoot = view.container.querySelector<HTMLDivElement>(".window");
  if (!windowRoot) throw new Error("window not rendered");
  return { view, windowRoot };
}

function committedGeometry(view: ReturnType<typeof render>) {
  return JSON.parse(
    view.getByRole("status", { name: "committed geometry" }).textContent ??
      "{}",
  ) as { position?: { x: number; y: number }; size?: object };
}

test("a second pointer neither moves nor ends a drag", () => {
  const { view, windowRoot } = renderDesktop();
  stubLayout(windowRoot, { offsetHeight: 100, offsetWidth: 200 });
  const titleBar = view.getByRole("toolbar", { name: "Window controls" });

  fireEvent.pointerDown(titleBar, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(document, { clientX: 300, clientY: 300, pointerId: 2 });
  act(() => {
    fireEvent.pointerUp(document, { pointerId: 2 });
  });

  expect(windowRoot.style.left).toBe("0px");
  expect(committedGeometry(view).position).toEqual({ x: 0, y: 0 });

  fireEvent.pointerMove(document, { clientX: 110, clientY: 60, pointerId: 1 });
  act(() => {
    fireEvent.pointerUp(document, { pointerId: 1 });
  });

  expect(committedGeometry(view).position).toEqual({ x: 100, y: 50 });
});

test("a host's geometry is clamped at its new size, not the old one", () => {
  const { view, windowRoot } = renderDesktop();
  // The window currently renders 600 wide; at that width x=500 would not fit.
  stubLayout(windowRoot, { offsetHeight: 400, offsetWidth: 600 });

  fireEvent.click(view.getByRole("button", { name: "Restore layout" }));

  expect(committedGeometry(view)).toEqual({
    position: { x: 500, y: 0 },
    size: { height: 100, width: 200 },
  });
  expect(windowRoot.style.left).toBe("500px");
  expect(windowRoot.style.width).toBe("200px");
});

test("clearing the committed size restores the default size", () => {
  const { view, windowRoot } = renderDesktop({
    size: { height: 200, width: 300 },
  });
  expect(windowRoot.style.width).toBe("300px");

  fireEvent.click(view.getByRole("button", { name: "Clear size" }));

  expect(windowRoot.style.width).toBe("");
  expect(committedGeometry(view).size).toBeUndefined();
});

test("a touch drag on the title bar moves the window and commits its position", () => {
  const { view, windowRoot } = renderDesktop();
  stubLayout(windowRoot, { offsetHeight: 100, offsetWidth: 200 });
  const titleBar = view.getByRole("toolbar", { name: "Window controls" });

  fireEvent.pointerDown(titleBar, {
    clientX: 10,
    clientY: 10,
    pointerType: "touch",
  });
  fireEvent.pointerMove(document, {
    clientX: 110,
    clientY: 60,
    pointerType: "touch",
  });

  expect(windowRoot.style.left).toBe("100px");
  expect(windowRoot.style.top).toBe("50px");
  expect(committedGeometry(view).position).toEqual({ x: 0, y: 0 });

  act(() => {
    fireEvent.pointerUp(document, { pointerType: "touch" });
  });

  expect(committedGeometry(view).position).toEqual({ x: 100, y: 50 });
});

test("a corner resize commits the window's new size", () => {
  const { view, windowRoot } = renderDesktop({
    size: { height: 200, width: 300 },
  });
  stubLayout(windowRoot, {
    clientHeight: 200,
    clientWidth: 300,
    offsetHeight: 200,
    offsetWidth: 300,
  });
  const corner = windowRoot.querySelector(".window-resize--se");
  if (!corner) throw new Error("resize corner not rendered");

  fireEvent.pointerDown(corner, { clientX: 300, clientY: 200 });
  fireEvent.pointerMove(document, { clientX: 350, clientY: 240 });
  act(() => {
    fireEvent.pointerUp(document);
  });

  expect(windowRoot.style.width).toBe("350px");
  expect(windowRoot.style.height).toBe("240px");
  expect(committedGeometry(view).size).toEqual({ height: 240, width: 350 });
});

test("a window created with a position and size opens there", () => {
  const { view, windowRoot } = renderDesktop({
    position: { x: 40, y: 30 },
    size: { height: 220, width: 320 },
  });

  expect(windowRoot.style.width).toBe("320px");
  expect(windowRoot.style.height).toBe("220px");
  expect(committedGeometry(view)).toEqual({
    position: { x: 40, y: 30 },
    size: { height: 220, width: 320 },
  });
});

test("geometry committed while minimized shows when the window is restored", () => {
  const { view, windowRoot } = renderDesktop();
  stubLayout(windowRoot, { offsetHeight: 100, offsetWidth: 200 });

  fireEvent.click(view.getByRole("button", { name: "Minimize notes" }));
  fireEvent.click(view.getByRole("button", { name: "Move notes" }));
  fireEvent.click(view.getByRole("button", { name: "Restore notes" }));

  const restored = view.container.querySelector<HTMLDivElement>(".window");
  expect(restored?.style.left).toBe("300px");
  expect(restored?.style.top).toBe("200px");
});

test("a second pointer pressing the controls cannot take over a drag", () => {
  const { view, windowRoot } = renderDesktop();
  stubLayout(windowRoot, { offsetHeight: 100, offsetWidth: 200 });
  const titleBar = view.getByRole("toolbar", { name: "Window controls" });
  const corner = windowRoot.querySelector(".window-resize--se");
  if (!corner) throw new Error("resize corner not rendered");

  fireEvent.pointerDown(titleBar, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerDown(titleBar, { clientX: 400, clientY: 400, pointerId: 2 });
  fireEvent.pointerDown(corner, { clientX: 200, clientY: 100, pointerId: 3 });
  fireEvent.pointerMove(document, { clientX: 500, clientY: 500, pointerId: 2 });
  fireEvent.pointerMove(document, { clientX: 260, clientY: 160, pointerId: 3 });
  expect(windowRoot.style.left).toBe("0px");
  expect(windowRoot.style.width).toBe("");

  fireEvent.pointerMove(document, { clientX: 110, clientY: 60, pointerId: 1 });
  act(() => {
    fireEvent.pointerUp(document, { pointerId: 1 });
  });

  expect(committedGeometry(view).position).toEqual({ x: 100, y: 50 });
});

test("clearing a size near the edge keeps the default-size window inside", () => {
  const { view, windowRoot } = renderDesktop({
    position: { x: 500, y: 300 },
    size: { height: 200, width: 300 },
  });
  // The stylesheet default renders the window at 400 x 300.
  for (const [property, fallback, dimension] of [
    ["offsetWidth", 400, "width"],
    ["offsetHeight", 300, "height"],
  ] as const) {
    Object.defineProperty(windowRoot, property, {
      configurable: true,
      get: () => Number.parseFloat(windowRoot.style[dimension]) || fallback,
    });
  }
  expect(committedGeometry(view).position).toEqual({ x: 500, y: 300 });

  fireEvent.click(view.getByRole("button", { name: "Clear size" }));

  expect(committedGeometry(view)).toEqual({ position: { x: 400, y: 300 } });
  expect(windowRoot.style.left).toBe("400px");
});

test("maximizing, minimizing, and restoring keeps the window's position", () => {
  // Every window element measures at the surface's full size while maximized,
  // including the fresh element a restore mounts.
  const prototype = HTMLElement.prototype;
  const originals = (["offsetWidth", "offsetHeight"] as const).map(
    (property) =>
      [property, Object.getOwnPropertyDescriptor(prototype, property)] as const,
  );
  const measure = (full: number, normal: number) =>
    function (this: HTMLElement) {
      if (!this.classList.contains("window")) return 0;
      return this.classList.contains("window--maximized") ? full : normal;
    };
  Object.defineProperty(prototype, "offsetWidth", {
    configurable: true,
    get: measure(800, 200),
  });
  Object.defineProperty(prototype, "offsetHeight", {
    configurable: true,
    get: measure(600, 100),
  });
  try {
    const { view } = renderDesktop({ position: { x: 300, y: 200 } });

    fireEvent.click(view.getByRole("button", { name: "Toggle maximize" }));
    fireEvent.click(view.getByRole("button", { name: "Minimize notes" }));
    fireEvent.click(view.getByRole("button", { name: "Restore notes" }));
    fireEvent.click(view.getByRole("button", { name: "Toggle maximize" }));

    expect(committedGeometry(view).position).toEqual({ x: 300, y: 200 });
    expect(
      view.container.querySelector<HTMLDivElement>(".window")?.style.left,
    ).toBe("300px");
  } finally {
    for (const [property, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(prototype, property, descriptor);
      } else {
        delete (prototype as Partial<Record<typeof property, number>>)[
          property
        ];
      }
    }
  }
});

test("a size below the stylesheet minimum clamps at the size it renders", () => {
  const { view } = renderDesktop({
    position: { x: 700, y: 0 },
    size: { height: 100, width: 100 },
  });

  // The window renders at its 200px minimum width, so x may be at most 600.
  expect(committedGeometry(view).position).toEqual({ x: 600, y: 0 });
});

test("moving a window while clearing its size clamps at the default size", () => {
  const { view, windowRoot } = renderDesktop({
    size: { height: 200, width: 600 },
  });
  // The stylesheet default renders the window at 400 x 300.
  for (const [property, fallback, dimension] of [
    ["offsetWidth", 400, "width"],
    ["offsetHeight", 300, "height"],
  ] as const) {
    Object.defineProperty(windowRoot, property, {
      configurable: true,
      get: () => Number.parseFloat(windowRoot.style[dimension]) || fallback,
    });
  }

  // x=300 fits at the 400px default, though not at the old 600px width.
  fireEvent.click(view.getByRole("button", { name: "Move notes" }));

  expect(committedGeometry(view)).toEqual({ position: { x: 300, y: 200 } });
  expect(windowRoot.style.left).toBe("300px");
});

test("a hidden surface keeps saved positions until it has a size", () => {
  const observers = captureResizeObservers();
  try {
    // The surface is unsized, as in an inactive workspace.
    const view = render(
      <WindowStateProvider>
        <DesktopHarness options={{ position: { x: 700, y: 550 } }} />
        <GeometryProbe />
      </WindowStateProvider>,
    );
    fireEvent.click(view.getByRole("button", { name: "Open notes" }));
    const windowRoot = view.container.querySelector<HTMLElement>(".window");
    if (!windowRoot) throw new Error("window not rendered");
    stubLayout(windowRoot, { offsetHeight: 100, offsetWidth: 200 });

    expect(committedGeometry(view).position).toEqual({ x: 700, y: 550 });

    stubLayout(view.getByTestId("surface"), {
      clientHeight: 600,
      clientWidth: 800,
    });
    act(() => observers.fire());

    expect(committedGeometry(view).position).toEqual({ x: 600, y: 500 });
  } finally {
    observers.restore();
  }
});

test("losing pointer capture ends a drag and commits it", () => {
  const { view, windowRoot } = renderDesktop();
  stubLayout(windowRoot, { offsetHeight: 100, offsetWidth: 200 });
  const titleBar = view.getByRole("toolbar", { name: "Window controls" });

  fireEvent.pointerDown(titleBar, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(document, { clientX: 110, clientY: 60, pointerId: 1 });
  act(() => {
    document.dispatchEvent(
      new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 1 }),
    );
  });

  expect(committedGeometry(view).position).toEqual({ x: 100, y: 50 });
});

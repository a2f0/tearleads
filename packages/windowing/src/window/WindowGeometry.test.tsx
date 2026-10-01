import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { stubLayout } from "./layout.testUtils";
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
  const { create } = useWindowActions();

  return (
    <>
      <button
        type="button"
        onClick={() => create("Notes", 0, 0, NotesContent, options)}
      >
        Open notes
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

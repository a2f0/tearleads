import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { Window } from "./Window";
import { useWindowState, WindowStateProvider } from "./WindowStateProvider";

afterEach(() => cleanup());

function WindowHarness() {
  const { windows, create } = useWindowState();

  useEffect(() => {
    create("A", 0, 0);
    create("B", 20, 20);
  }, [create]);

  return (
    <div>
      {windows.map((window) => (
        <Window key={window.id} windowId={window.id} />
      ))}
    </div>
  );
}

test("maximizing a background window brings it to the front", async () => {
  const view = render(
    <WindowStateProvider>
      <WindowHarness />
    </WindowStateProvider>,
  );

  await waitFor(() => {
    expect(view.getByText("A")).toBeTruthy();
    expect(view.getByText("B")).toBeTruthy();
  });

  const windowA = view.getByText("A").closest<HTMLDivElement>(".window");
  const windowB = view.getByText("B").closest<HTMLDivElement>(".window");
  if (!windowA || !windowB) throw new Error("window not found");

  const maximizeButton =
    windowA.querySelector<HTMLButtonElement>(".window-maximize");
  if (!maximizeButton) throw new Error("maximize button not found");

  expect(windowA.style.zIndex).toBe("1");
  expect(windowB.style.zIndex).toBe("2");

  fireEvent.click(maximizeButton);

  expect(windowA.className).toContain("window--maximized");
  expect(windowA.style.zIndex).toBe("2");
  expect(windowB.style.zIndex).toBe("1");
});

test("maximized window has no inline position or size constraints", async () => {
  const view = render(
    <WindowStateProvider>
      <WindowHarness />
    </WindowStateProvider>,
  );

  await waitFor(() => {
    expect(view.getByText("A")).toBeTruthy();
  });

  const windowA = view.getByText("A").closest<HTMLDivElement>(".window");
  if (!windowA) throw new Error("window not found");

  const maximizeButton =
    windowA.querySelector<HTMLButtonElement>(".window-maximize");
  if (!maximizeButton) throw new Error("maximize button not found");

  fireEvent.click(maximizeButton);

  expect(windowA.className).toContain("window--maximized");

  const style = windowA.style;
  // Inline styles must not set width/height/left/top so CSS can stretch the window
  expect(style.width).toBe("");
  expect(style.height).toBe("");
  expect(style.left).toBe("");
  expect(style.top).toBe("");
});

test("maximized window CSS overrides base width and height", async () => {
  const css = await Bun.file(
    new URL("./Window.css", import.meta.url).pathname,
  ).text();

  // Extract the .window--maximized rule block
  const match = css.match(/\.window--maximized\s*\{([^}]+)\}/);
  expect(match).toBeTruthy();

  const body = match?.[1];
  // The maximized rule must set width and height (not just min-width/min-height)
  // to override the base .window { width: 600px; height: 400px } so that
  // top/left/right/bottom: 0 can stretch the window to fill its parent.
  expect(body).toMatch(/(?<![a-z-])width\s*:/);
  expect(body).toMatch(/(?<![a-z-])height\s*:/);
});

test("right-clicking a rendered window title bar opens the window menu", async () => {
  const view = render(
    <WindowStateProvider>
      <WindowHarness />
    </WindowStateProvider>,
  );

  await waitFor(() => {
    expect(view.getByText("A")).toBeTruthy();
  });

  const titleBar = view.getAllByRole("toolbar")[0];
  if (!titleBar) throw new Error("title bar not found");

  fireEvent.mouseDown(titleBar, { button: 2 });
  fireEvent.contextMenu(titleBar, { clientX: 100, clientY: 120 });

  expect(view.getByText("Move Forward")).toBeTruthy();
  expect(view.getByText("Move Backward")).toBeTruthy();
});

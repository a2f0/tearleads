import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { type PropsWithChildren, useEffect } from "react";
import { Window } from "./Window";
import {
  useWindowActions,
  useWindowStateData,
  type WindowEntry,
  WindowStateProvider,
} from "./WindowStateProvider";

afterEach(cleanup);

function WindowHarness() {
  const { windows } = useWindowStateData();
  const { create } = useWindowActions();

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

function HostBoundary({
  children,
  entry,
}: PropsWithChildren<{ entry: WindowEntry }>) {
  return (
    <section aria-label={`boundary for ${entry.appId}`}>{children}</section>
  );
}

function BoundaryHarness() {
  const { windows } = useWindowStateData();
  const { create } = useWindowActions();

  useEffect(() => {
    function Content() {
      return <p>window content</p>;
    }

    create("Owned", 0, 0, Content, { appId: "host-app" });
  }, [create]);

  return (
    <div>
      {windows.map((window) => (
        <Window
          key={window.id}
          ContentBoundary={HostBoundary}
          windowId={window.id}
        />
      ))}
    </div>
  );
}

test("a host's content boundary wraps the window content with its entry", async () => {
  const view = render(
    <WindowStateProvider>
      <BoundaryHarness />
    </WindowStateProvider>,
  );

  const boundary = await view.findByRole("region", {
    name: "boundary for host-app",
  });
  expect(boundary.textContent).toBe("window content");
});

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

test("clicking a background window brings it to the front", async () => {
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

  expect(windowA.style.zIndex).toBe("1");
  expect(windowB.style.zIndex).toBe("2");

  fireEvent.pointerDown(windowA);

  expect(windowA.style.zIndex).toBe("2");
  expect(windowB.style.zIndex).toBe("1");
});

test("maximized window fills its parent via inline styles", async () => {
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
  expect(style.top).toBe("0px");
  expect(style.left).toBe("0px");
  expect(style.width).toBe("100%");
  expect(style.height).toBe("100%");
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

  fireEvent.pointerDown(titleBar, { button: 2 });
  fireEvent.contextMenu(titleBar, { clientX: 100, clientY: 120 });

  expect(view.getByText("Move Forward")).toBeTruthy();
  expect(view.getByText("Move Backward")).toBeTruthy();
});

import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { Window } from "./Window";
import {
  useWindowFileMenuItem,
  useWindowRefreshMenuItem,
} from "./WindowMenuContext";
import { useWindowSidebar } from "./WindowSidebarContext";
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

function WindowRefreshHarness({ onRefresh }: { onRefresh: () => void }) {
  const { windows, create } = useWindowState();

  useEffect(() => {
    function RefreshableWindow() {
      useWindowRefreshMenuItem({ onRefresh });
      return <div>Refreshable content</div>;
    }

    create("Refreshable", 0, 0, RefreshableWindow);
  }, [create, onRefresh]);

  return (
    <div>
      {windows.map((window) => (
        <Window key={window.id} windowId={window.id} />
      ))}
    </div>
  );
}

function WindowFileMenuHarness({ onCreate }: { onCreate: () => void }) {
  const { windows, create } = useWindowState();

  useEffect(() => {
    function FileMenuWindow() {
      useWindowFileMenuItem({
        id: "test-new-structured-document",
        label: "New Structured Document",
        onClick: onCreate,
      });
      return <div>File menu content</div>;
    }

    create("File Menu", 0, 0, FileMenuWindow);
  }, [create, onCreate]);

  return (
    <div>
      {windows.map((window) => (
        <Window key={window.id} windowId={window.id} />
      ))}
    </div>
  );
}

function WindowMultiRefreshHarness({
  onFirstRefresh,
  onSecondRefresh,
}: {
  onFirstRefresh: () => void;
  onSecondRefresh: () => void;
}) {
  const { windows, create } = useWindowState();

  useEffect(() => {
    function MultiRefreshableWindow() {
      useWindowRefreshMenuItem({
        label: "First refresh",
        onRefresh: onFirstRefresh,
      });
      useWindowRefreshMenuItem({
        label: "Second refresh",
        onRefresh: onSecondRefresh,
      });
      return <div>Multi refreshable content</div>;
    }

    create("Multi Refreshable", 0, 0, MultiRefreshableWindow);
  }, [create, onFirstRefresh, onSecondRefresh]);

  return (
    <div>
      {windows.map((window) => (
        <Window key={window.id} windowId={window.id} />
      ))}
    </div>
  );
}

function RegisteredSidebarContent() {
  const { setSidebar } = useWindowSidebar();

  useEffect(() => {
    setSidebar(<div>Registered Sidebar</div>);
    return () => setSidebar(null);
  }, [setSidebar]);

  return <div>Main Content</div>;
}

function NoSidebarContent() {
  return <div>Main Content</div>;
}

function WindowNoSidebarHarness() {
  const { windows, create } = useWindowState();

  useEffect(() => {
    create("No Sidebar", 0, 0, NoSidebarContent);
  }, [create]);

  return (
    <div>
      {windows.map((window) => (
        <Window key={window.id} windowId={window.id} />
      ))}
    </div>
  );
}

function WindowSidebarDefaultHarness({
  initialShowSidebar,
}: {
  initialShowSidebar: boolean;
}) {
  const { windows, create } = useWindowState();

  useEffect(() => {
    create("Sidebar Defaults", 0, 0, RegisteredSidebarContent, {
      initialShowSidebar,
    });
  }, [create, initialShowSidebar]);

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

  fireEvent.mouseDown(windowA);

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

  fireEvent.mouseDown(titleBar, { button: 2 });
  fireEvent.contextMenu(titleBar, { clientX: 100, clientY: 120 });

  expect(view.getByText("Move Forward")).toBeTruthy();
  expect(view.getByText("Move Backward")).toBeTruthy();
});

test("registered refresh action appears in the view menu", async () => {
  let refreshCount = 0;
  const view = render(
    <WindowStateProvider>
      <WindowRefreshHarness
        onRefresh={() => {
          refreshCount += 1;
        }}
      />
    </WindowStateProvider>,
  );

  await waitFor(() => {
    expect(view.getByText("Refreshable content")).toBeTruthy();
  });

  fireEvent.click(view.getByText("View"));

  await waitFor(() => {
    expect(view.getByText("Refresh")).toBeTruthy();
  });

  fireEvent.click(view.getByText("Refresh"));

  expect(refreshCount).toBe(1);
});

test("registered file action appears in the file menu", async () => {
  let createCount = 0;
  const view = render(
    <WindowStateProvider>
      <WindowFileMenuHarness
        onCreate={() => {
          createCount += 1;
        }}
      />
    </WindowStateProvider>,
  );

  await waitFor(() => {
    expect(view.getByText("File menu content")).toBeTruthy();
  });

  fireEvent.click(view.getByText("File"));

  await waitFor(() => {
    expect(view.getByText("New Structured Document")).toBeTruthy();
  });

  fireEvent.click(view.getByText("New Structured Document"));

  expect(createCount).toBe(1);
});

test("equal-priority refresh actions prefer the first registered item", async () => {
  let firstRefreshCount = 0;
  let secondRefreshCount = 0;
  const view = render(
    <WindowStateProvider>
      <WindowMultiRefreshHarness
        onFirstRefresh={() => {
          firstRefreshCount += 1;
        }}
        onSecondRefresh={() => {
          secondRefreshCount += 1;
        }}
      />
    </WindowStateProvider>,
  );

  await waitFor(() => {
    expect(view.getByText("Multi refreshable content")).toBeTruthy();
  });

  fireEvent.click(view.getByText("View"));

  await waitFor(() => {
    expect(view.getByText("First refresh")).toBeTruthy();
  });

  expect(view.queryByText("Second refresh")).toBeNull();

  fireEvent.click(view.getByText("First refresh"));

  expect(firstRefreshCount).toBe(1);
  expect(secondRefreshCount).toBe(0);
});

test("window can start with the sidebar hidden", async () => {
  const view = render(
    <WindowStateProvider>
      <WindowSidebarDefaultHarness initialShowSidebar={false} />
    </WindowStateProvider>,
  );

  await waitFor(() => {
    expect(view.getByText("Main Content")).toBeTruthy();
  });

  expect(view.queryByText("Registered Sidebar")).toBeNull();

  fireEvent.click(view.getByText("View"));

  await waitFor(() => {
    expect(view.getByText("Show Sidebar")).toBeTruthy();
  });

  fireEvent.click(view.getByText("Show Sidebar"));

  await waitFor(() => {
    expect(view.getByText("Registered Sidebar")).toBeTruthy();
  });
});

test("window hides sidebar chrome until sidebar content is registered", async () => {
  const view = render(
    <WindowStateProvider>
      <WindowNoSidebarHarness />
    </WindowStateProvider>,
  );

  await waitFor(() => {
    expect(view.getByText("Main Content")).toBeTruthy();
  });

  expect(view.container.querySelector(".window-sidebar-layout")).toBeNull();
});

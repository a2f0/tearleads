import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useEffect, useMemo } from "react";
import { Window } from "./Window";
import {
  useWindowBackAction,
  useWindowFileMenuItem,
  useWindowRefreshMenuItem,
  useWindowTitleBarAction,
} from "./WindowMenuContext";
import { useWindowSidebar } from "./WindowSidebarContext";
import {
  useWindowActions,
  useWindowStateData,
  WindowStateProvider,
} from "./WindowStateProvider";

afterEach(cleanup);

function RenderedWindows() {
  const { windows } = useWindowStateData();
  return windows.map((window) => (
    <Window key={window.id} windowId={window.id} />
  ));
}

function WindowRefreshHarness({ onRefresh }: { onRefresh: () => void }) {
  const { create } = useWindowActions();

  useEffect(() => {
    function RefreshableWindow() {
      useWindowRefreshMenuItem({ onRefresh });
      return <div>Refreshable content</div>;
    }

    create("Refreshable", 0, 0, RefreshableWindow);
  }, [create, onRefresh]);

  return <RenderedWindows />;
}

function WindowFileMenuHarness({ onCreate }: { onCreate: () => void }) {
  const { create } = useWindowActions();

  useEffect(() => {
    function FileMenuWindow() {
      useWindowFileMenuItem({
        id: "test-new-structured-document",
        label: "New Document",
        onClick: onCreate,
      });
      return <div>File menu content</div>;
    }

    create("File Menu", 0, 0, FileMenuWindow);
  }, [create, onCreate]);

  return <RenderedWindows />;
}

function WindowToolBarHarness({
  onAction,
  onBack,
}: {
  onAction: () => void;
  onBack: () => void;
}) {
  const { create } = useWindowActions();

  useEffect(() => {
    function ToolBarWindow() {
      const action = useMemo(
        () => ({
          icon: <span aria-hidden>i</span>,
          id: "toolbar-action",
          label: "Get Info",
          onClick: onAction,
        }),
        [],
      );
      const back = useMemo(
        () => ({ label: "Back to Container", onClick: onBack }),
        [],
      );
      useWindowTitleBarAction(action);
      useWindowBackAction(back);
      return <div>Toolbar content</div>;
    }

    create("Toolbar", 0, 0, ToolBarWindow);
  }, [create, onAction, onBack]);

  return <RenderedWindows />;
}

function WindowMultiRefreshHarness({
  onFirstRefresh,
  onSecondRefresh,
}: {
  onFirstRefresh: () => void;
  onSecondRefresh: () => void;
}) {
  const { create } = useWindowActions();

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

  return <RenderedWindows />;
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
  const { create } = useWindowActions();

  useEffect(() => {
    create("No Sidebar", 0, 0, NoSidebarContent);
  }, [create]);

  return <RenderedWindows />;
}

function WindowSidebarDefaultHarness({
  initialShowSidebar,
}: {
  initialShowSidebar: boolean;
}) {
  const { create } = useWindowActions();

  useEffect(() => {
    create("Sidebar Defaults", 0, 0, RegisteredSidebarContent, {
      initialShowSidebar,
    });
  }, [create, initialShowSidebar]);

  return <RenderedWindows />;
}

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
    expect(view.getByText("New Document")).toBeTruthy();
  });
  fireEvent.click(view.getByText("New Document"));

  expect(createCount).toBe(1);
});

test("registered title-bar and back actions render in the window toolbar row", async () => {
  let actionClicks = 0;
  let backClicks = 0;
  const view = render(
    <WindowStateProvider>
      <WindowToolBarHarness
        onAction={() => {
          actionClicks += 1;
        }}
        onBack={() => {
          backClicks += 1;
        }}
      />
    </WindowStateProvider>,
  );

  await waitFor(() => {
    expect(view.getByText("Toolbar content")).toBeTruthy();
  });

  const toolbar = view.container.querySelector(".window-toolbar");
  expect(toolbar).not.toBeNull();

  const infoButton = view.getByRole("button", { name: "Get Info" });
  const backButton = view.getByRole("button", { name: "Back to Container" });
  expect(infoButton.closest(".window-toolbar")).toBe(toolbar);
  expect(backButton.closest(".window-toolbar")).toBe(toolbar);

  fireEvent.click(infoButton);
  fireEvent.click(backButton);

  expect(actionClicks).toBe(1);
  expect(backClicks).toBe(1);
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
  fireEvent.click(view.getByText("View"));
  await waitFor(() => {
    expect(view.getByText("Hide Status Bar")).toBeTruthy();
  });
  expect(view.queryByText("Show Sidebar")).toBeNull();
  expect(view.queryByText("Hide Sidebar")).toBeNull();
});

test("window chrome renders no status bar band while idle", async () => {
  // The status bar only holds transient messages; an idle window must sit flush
  // on the taskbar rather than reserving a muted band above it.
  const view = render(
    <WindowStateProvider>
      <WindowNoSidebarHarness />
    </WindowStateProvider>,
  );

  await waitFor(() => {
    expect(view.getByText("Main Content")).toBeTruthy();
  });

  expect(view.container.querySelector(".window-statusbar")).toBeNull();
});

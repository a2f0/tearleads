import { afterEach, expect, test } from "bun:test";
import {
  useWindowActions,
  useWindowSidebar,
  useWindowStateData,
  useWindowTitleBarAction,
  Window,
  WindowStateProvider,
} from "@tearleads/windowing";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useEffect, useMemo, useState } from "react";
import { MiniAppClipboardButton, MiniAppImageViewer } from "./MiniAppLayout";

// Mini-app chrome rendered inside a real window: status-bar feedback from the
// clipboard button, and the image viewer's toolbar suppression and placement.

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "clipboard",
);

afterEach(() => {
  cleanup();
  if (originalClipboardDescriptor) {
    Object.defineProperty(
      Navigator.prototype,
      "clipboard",
      originalClipboardDescriptor,
    );
  } else {
    delete (Navigator.prototype as { clipboard?: Clipboard }).clipboard;
  }
});

function installClipboard(writeText: Clipboard["writeText"]): void {
  Object.defineProperty(Navigator.prototype, "clipboard", {
    configurable: true,
    get: () => ({ writeText }),
  });
}

function WindowClipboardHarness() {
  const { windows } = useWindowStateData();
  const { create } = useWindowActions();

  useEffect(() => {
    function ClipboardWindow() {
      return <MiniAppClipboardButton label="Copy user ID" value="user-1" />;
    }

    create("Clipboard", 0, 0, ClipboardWindow);
  }, [create]);

  return (
    <div>
      {windows.map((window) => (
        <Window key={window.id} windowId={window.id} />
      ))}
    </div>
  );
}

function ImageViewerWindow({ withSidebar = true }: { withSidebar?: boolean }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const { setSidebar } = useWindowSidebar();
  // Stands in for the blob browser's "Open" action: a window toolbar control that
  // opens the viewer, so the opener is a control the suppression unmounts.
  const toolbarAction = useMemo(
    () => ({
      icon: <span aria-hidden>+</span>,
      id: "viewer-window-action",
      label: "Open image",
      onClick: () => setViewerOpen(true),
    }),
    [],
  );
  useWindowTitleBarAction(toolbarAction);

  useEffect(() => {
    if (!withSidebar) return;

    setSidebar(<div>Viewer sidebar</div>);
    return () => setSidebar(null);
  }, [setSidebar, withSidebar]);

  return (
    <>
      <button type="button" onClick={() => setViewerOpen(true)}>
        Open viewer
      </button>
      {viewerOpen ? (
        <MiniAppImageViewer
          label="photo.png"
          onClose={() => setViewerOpen(false)}
          url="blob:photo"
        />
      ) : null}
    </>
  );
}

function SidebarlessImageViewerWindow() {
  return <ImageViewerWindow withSidebar={false} />;
}

function WindowViewerHarness({
  withSidebar = true,
}: {
  withSidebar?: boolean;
}) {
  const { windows } = useWindowStateData();
  const { create, restore } = useWindowActions();

  useEffect(() => {
    create(
      "Viewer",
      0,
      0,
      withSidebar ? ImageViewerWindow : SidebarlessImageViewerWindow,
    );
  }, [create, withSidebar]);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          const viewerWindow = windows[0];
          if (viewerWindow) {
            restore(viewerWindow.id);
          }
        }}
      >
        Restore viewer
      </button>
      {windows.map((window) => (
        <Window key={window.id} windowId={window.id} />
      ))}
    </div>
  );
}

test("clipboard actions publish status bar feedback", async () => {
  installClipboard(() => Promise.resolve());
  const view = render(
    <WindowStateProvider>
      <WindowClipboardHarness />
    </WindowStateProvider>,
  );

  await waitFor(() => {
    expect(view.getByRole("button", { name: "Copy user ID" })).toBeTruthy();
  });

  fireEvent.click(view.getByRole("button", { name: "Copy user ID" }));

  await waitFor(() => {
    expect(view.getByRole("status").textContent).toBe(
      "Successfully copied to clipboard",
    );
  });
});

test("the image viewer stays in the right pane after restoring its window", async () => {
  const view = render(
    <WindowStateProvider>
      <WindowViewerHarness />
    </WindowStateProvider>,
  );

  const open = await view.findByRole("button", { name: "Open viewer" });
  const firstHost = open.closest<HTMLDivElement>(".window");
  if (!firstHost) throw new Error("viewer window not found");

  const minimize =
    firstHost.querySelector<HTMLButtonElement>(".window-minimize");
  if (!minimize) throw new Error("minimize button not found");
  fireEvent.click(minimize);
  expect(firstHost.isConnected).toBe(false);

  fireEvent.click(view.getByRole("button", { name: "Restore viewer" }));
  const restoredOpen = await view.findByRole("button", {
    name: "Open viewer",
  });
  const restoredHost = restoredOpen.closest<HTMLDivElement>(".window");
  if (!restoredHost) throw new Error("restored viewer window not found");
  expect(restoredHost).not.toBe(firstHost);

  fireEvent.click(restoredOpen);
  const rightPane = restoredHost.querySelector<HTMLDivElement>(
    ".window-sidebar-content",
  );
  const sidebar = restoredHost.querySelector(".window-sidebar");
  expect(view.getByRole("dialog").parentElement).toBe(rightPane);
  expect(sidebar?.contains(view.getByRole("dialog"))).toBe(false);
});

// The viewer brings its own toolbar, so the window's row steps aside for it and
// the pane is never chromed by two toolbars at once.
test("only the viewer's toolbar is left while it is open", async () => {
  const view = render(
    <WindowStateProvider>
      <WindowViewerHarness withSidebar={false} />
    </WindowStateProvider>,
  );

  const open = await view.findByRole("button", { name: "Open viewer" });
  const host = open.closest<HTMLDivElement>(".window");
  if (!host) throw new Error("viewer window not found");
  await waitFor(() => {
    expect(host.querySelector(".window-toolbar")).toBeTruthy();
  });

  fireEvent.click(open);
  expect(host.querySelector(".window-toolbar")).toBeNull();
  expect(host.querySelector(".mini-app-image-viewer-toolbar")).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: "Close" }));
  await waitFor(() => {
    expect(host.querySelector(".window-toolbar")).toBeTruthy();
  });
});

// The blob browser opens this viewer from a window toolbar action — the very row
// the viewer stands down. Its opener is therefore gone by the time the viewer
// closes, so focus has to land in the pane instead of falling to the body.
test("closing a toolbar-opened viewer keeps focus inside the window", async () => {
  const view = render(
    <WindowStateProvider>
      <WindowViewerHarness withSidebar={false} />
    </WindowStateProvider>,
  );

  const open = await view.findByRole("button", { name: "Open viewer" });
  const host = open.closest<HTMLDivElement>(".window");
  if (!host) throw new Error("viewer window not found");
  const toolbarOpen = await waitFor(() => {
    const button = host.querySelector<HTMLButtonElement>(
      '.window-toolbar [aria-label="Open image"]',
    );
    if (!button) throw new Error("toolbar open action not registered");
    return button;
  });

  toolbarOpen.focus();
  fireEvent.click(toolbarOpen);
  // Standing the row down takes the opener with it.
  expect(toolbarOpen.isConnected).toBe(false);

  fireEvent.click(view.getByRole("button", { name: "Close" }));
  expect(document.activeElement).toBe(
    host.querySelector(".window-body-content"),
  );
});

test("a sidebarless image viewer stays in the window content pane", async () => {
  const view = render(
    <WindowStateProvider>
      <WindowViewerHarness withSidebar={false} />
    </WindowStateProvider>,
  );

  fireEvent.click(await view.findByRole("button", { name: "Open viewer" }));

  const viewer = view.getByRole("dialog");
  expect(viewer.parentElement?.className).toBe("window-body-content");
  expect(viewer.parentElement?.closest(".window")).toBeTruthy();
});

import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import {
  MiniAppClipboardButton,
  MiniAppImageViewer,
} from "../mini-app/MiniAppLayout";
import { Window } from "./Window";
import { useWindowState, WindowStateProvider } from "./WindowStateProvider";

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

function WindowClipboardHarness() {
  const { windows, create } = useWindowState();

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

function ImageViewerWindow() {
  const [viewerOpen, setViewerOpen] = useState(false);
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

function WindowViewerHarness() {
  const { windows, create, restore } = useWindowState();

  useEffect(() => {
    create("Viewer", 0, 0, ImageViewerWindow);
  }, [create]);

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

test("restoring a window refreshes its image viewer host", async () => {
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
  expect(view.getByRole("dialog").parentElement).toBe(restoredHost);
});

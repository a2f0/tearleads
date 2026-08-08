import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { Window } from "./Window";
import {
  useWindowActions,
  useWindowStateData,
  WindowStateProvider,
} from "./WindowStateProvider";

afterEach(() => {
  cleanup();
});

function ContextMenuWindowContent({
  onContextMenu,
}: {
  onContextMenu?: (() => void) | undefined;
}) {
  return (
    <button type="button" onContextMenu={onContextMenu}>
      Window context target
    </button>
  );
}

function WindowContextMenuHarness({
  onDesktopContextMenu,
  onWindowContextMenu,
}: {
  onDesktopContextMenu: () => void;
  onWindowContextMenu?: (() => void) | undefined;
}) {
  const { windows } = useWindowStateData();
  const { create } = useWindowActions();

  useEffect(() => {
    function ContextMenuWindow() {
      return <ContextMenuWindowContent onContextMenu={onWindowContextMenu} />;
    }

    create("Context Menu", 0, 0, ContextMenuWindow);
  }, [create, onWindowContextMenu]);

  return (
    <section
      aria-label="Desktop"
      data-testid="desktop"
      onContextMenu={onDesktopContextMenu}
      role="application"
    >
      {windows.map((window) => (
        <Window key={window.id} windowId={window.id} />
      ))}
    </section>
  );
}

test("window context menus do not fall through to the desktop", async () => {
  let desktopContextMenuCount = 0;
  const view = render(
    <WindowStateProvider>
      <WindowContextMenuHarness
        onDesktopContextMenu={() => {
          desktopContextMenuCount += 1;
        }}
      />
    </WindowStateProvider>,
  );

  await waitFor(() => {
    expect(view.getByText("Window context target")).toBeTruthy();
  });

  fireEvent.contextMenu(view.getByTestId("desktop"));
  expect(desktopContextMenuCount).toBe(1);

  fireEvent.contextMenu(view.getByText("Window context target"));
  expect(desktopContextMenuCount).toBe(1);
});

test("window context-menu trap preserves window-local handlers", async () => {
  let desktopContextMenuCount = 0;
  let windowContextMenuCount = 0;
  const view = render(
    <WindowStateProvider>
      <WindowContextMenuHarness
        onDesktopContextMenu={() => {
          desktopContextMenuCount += 1;
        }}
        onWindowContextMenu={() => {
          windowContextMenuCount += 1;
        }}
      />
    </WindowStateProvider>,
  );

  await waitFor(() => {
    expect(view.getByText("Window context target")).toBeTruthy();
  });

  fireEvent.contextMenu(view.getByText("Window context target"));

  expect(windowContextMenuCount).toBe(1);
  expect(desktopContextMenuCount).toBe(0);
});

import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import type { WindowingIconProps } from "../icons/windowingIcon";
import { LauncherNavigationProvider } from "../launcher/LauncherNavigationProvider";
import type { LauncherDefinition } from "../launcher/launcherDefinition";
import {
  useWindowStateData,
  WindowStateProvider,
} from "../window/WindowStateProvider";
import { DesktopIcons, type DesktopIconsProps } from "./DesktopIcons";
import { DESKTOP_ICON_GRID } from "./desktopState";
import {
  createMemoryDesktopStateStorage,
  type DesktopStateStorage,
} from "./desktopStateStorage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const EmptyApp = () => null;

function FolderIcon({ className, size }: WindowingIconProps) {
  return <svg className={className} data-icon="folder" width={size} />;
}

const LAUNCHER: LauncherDefinition<"explorer" | "notes"> = {
  apps: {
    explorer: {
      createComponent: () => EmptyApp,
      icon: FolderIcon,
      title: "Explorer",
    },
    notes: { createComponent: () => EmptyApp, title: "Notes" },
  },
};

function OpenWindows() {
  const { windows } = useWindowStateData();
  return (
    <output data-testid="windows">
      {windows.map((entry) => entry.appId).join(",")}
    </output>
  );
}

function renderDesktop(props: DesktopIconsProps<"explorer" | "notes">) {
  return render(
    <WindowStateProvider>
      <LauncherNavigationProvider definition={LAUNCHER} mode="windowed">
        <DesktopIcons {...props} />
        <OpenWindows />
      </LauncherNavigationProvider>
    </WindowStateProvider>,
  );
}

// Renders and lets the stored layout load, as the desktop would on mount.
async function renderLoadedDesktop(
  props: DesktopIconsProps<"explorer" | "notes">,
) {
  const view = renderDesktop(props);
  await act(async () => {});
  return view;
}

function icon(view: ReturnType<typeof render>, name: string) {
  return view.getByRole("option", { name });
}

function drag(element: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(element, {
    button: 0,
    clientX: from,
    clientY: from,
    pointerId: 1,
  });
  fireEvent.pointerMove(element, { clientX: to, clientY: to, pointerId: 1 });
  fireEvent.pointerUp(element, { clientX: to, clientY: to, pointerId: 1 });
}

const { originX, originY } = DESKTOP_ICON_GRID;

test("shows the launcher's apps it is given, with their icons", async () => {
  const view = await renderLoadedDesktop({ appIds: ["explorer", "notes"] });
  const group = view.getByRole("listbox", { name: "Desktop" });
  expect(group.querySelectorAll(".desktop-icon")).toHaveLength(2);
  expect(icon(view, "Explorer").querySelector("[data-icon=folder]")).not.toBe(
    null,
  );
  expect(icon(view, "Explorer").style.left).toBe(`${originX}px`);
  expect(icon(view, "Explorer").style.top).toBe(`${originY}px`);
});

test("double-click and Enter open the app through the launcher", async () => {
  const view = await renderLoadedDesktop({ appIds: ["explorer", "notes"] });

  fireEvent.click(icon(view, "Explorer"));
  expect(view.getByTestId("windows").textContent).toBe("");

  fireEvent.doubleClick(icon(view, "Explorer"));
  expect(view.getByTestId("windows").textContent).toBe("explorer");

  fireEvent.keyDown(icon(view, "Notes"), { key: "Enter" });
  expect(view.getByTestId("windows").textContent).toBe("explorer,notes");
});

test("arrow keys move the selection and Tab's stop between icons", async () => {
  const view = await renderLoadedDesktop({ appIds: ["explorer", "notes"] });
  const explorer = icon(view, "Explorer");
  const notes = icon(view, "Notes");
  expect([explorer.tabIndex, notes.tabIndex]).toEqual([0, -1]);

  fireEvent.keyDown(explorer, { key: "ArrowDown" });
  expect(notes.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(notes);
  expect([explorer.tabIndex, notes.tabIndex]).toEqual([-1, 0]);

  fireEvent.keyDown(notes, { key: "Home" });
  expect(document.activeElement).toBe(explorer);

  fireEvent.pointerDown(document.body);
  expect(explorer.getAttribute("aria-selected")).toBe("false");
});

test("a host's onOpen replaces the launcher's", async () => {
  const opened: string[] = [];
  const view = await renderLoadedDesktop({
    appIds: ["notes"],
    onOpen: (appId) => opened.push(appId),
  });
  fireEvent.doubleClick(icon(view, "Notes"));
  expect(opened).toEqual(["notes"]);
  expect(view.getByTestId("windows").textContent).toBe("");
});

test("right-click offers Open and the host's items", async () => {
  const renamed: string[] = [];
  const view = await renderLoadedDesktop({
    appIds: ["explorer"],
    menuItems: (appId) => [
      { id: "rename", label: "Rename", onSelect: () => renamed.push(appId) },
    ],
  });

  fireEvent.contextMenu(icon(view, "Explorer"), { clientX: 30, clientY: 40 });
  expect(icon(view, "Explorer").getAttribute("aria-selected")).toBe("true");
  fireEvent.click(view.getByRole("button", { name: "Rename" }));
  expect(renamed).toEqual(["explorer"]);
  expect(view.queryByRole("button", { name: "Open" })).toBeNull();

  fireEvent.contextMenu(icon(view, "Explorer"), { clientX: 30, clientY: 40 });
  fireEvent.click(view.getByRole("button", { name: "Open" }));
  expect(view.getByTestId("windows").textContent).toBe("explorer");
});

test("a dragged icon moves, and its position persists", async () => {
  const storage = createMemoryDesktopStateStorage();
  const view = await renderLoadedDesktop({ appIds: ["explorer"], storage });
  const explorer = icon(view, "Explorer");

  // A press that barely moves is a click, not a drag.
  drag(explorer, 100, 102);
  expect(explorer.style.left).toBe(`${originX}px`);

  drag(explorer, 100, 150);
  expect(explorer.style.left).toBe(`${originX + 50}px`);
  expect(explorer.style.top).toBe(`${originY + 50}px`);
  await waitFor(async () =>
    expect(JSON.parse((await storage.read()) ?? "null")).toEqual({
      icons: { explorer: { x: originX + 50, y: originY + 50 } },
      version: 1,
    }),
  );

  cleanup();
  const reloaded = renderDesktop({ appIds: ["explorer"], storage });
  await waitFor(() =>
    expect(icon(reloaded, "Explorer").style.left).toBe(`${originX + 50}px`),
  );
});

function deferredStorage(): DesktopStateStorage & {
  resolveRead: (serialized: string | null) => void;
  rejectRead: () => void;
  writes: string[];
} {
  let resolveRead: (serialized: string | null) => void = () => {};
  let rejectRead: () => void = () => {};
  const writes: string[] = [];
  const read = new Promise<string | null>((resolve, reject) => {
    resolveRead = resolve;
    rejectRead = () => reject(new Error("locked"));
  });
  return {
    read: () => read,
    rejectRead: () => rejectRead(),
    resolveRead: (serialized) => resolveRead(serialized),
    write: async (serialized) => {
      writes.push(serialized);
    },
    writes,
  };
}

test("a move before the load wins, and is saved with the stored layout", async () => {
  const storage = deferredStorage();
  const view = renderDesktop({ appIds: ["explorer", "notes"], storage });

  drag(icon(view, "Explorer"), 100, 200);
  expect(storage.writes).toEqual([]);

  await act(async () =>
    storage.resolveRead(
      JSON.stringify({
        icons: { explorer: { x: 5, y: 5 }, notes: { x: 300, y: 20 } },
        version: 1,
      }),
    ),
  );

  expect(icon(view, "Explorer").style.left).toBe(`${originX + 100}px`);
  expect(icon(view, "Notes").style.left).toBe("300px");
  await waitFor(() => expect(storage.writes).toHaveLength(1));
  expect(JSON.parse(storage.writes[0] ?? "null").icons).toEqual({
    explorer: { x: originX + 100, y: originY + 100 },
    notes: { x: 300, y: 20 },
  });
});

test("a failed load keeps moves in memory and writes nothing", async () => {
  const storage = deferredStorage();
  const view = renderDesktop({ appIds: ["explorer"], storage });
  await act(async () => storage.rejectRead());

  drag(icon(view, "Explorer"), 100, 140);
  expect(icon(view, "Explorer").style.left).toBe(`${originX + 40}px`);
  await act(async () => {});
  expect(storage.writes).toEqual([]);
});

test("a new storage adapter reloads its own layout and keeps the old one's out", async () => {
  const first = deferredStorage();
  const second = deferredStorage();
  const props = { appIds: ["explorer", "notes"] as const };
  const tree = (storage: DesktopStateStorage) => (
    <WindowStateProvider>
      <LauncherNavigationProvider definition={LAUNCHER} mode="windowed">
        <DesktopIcons appIds={props.appIds} storage={storage} />
      </LauncherNavigationProvider>
    </WindowStateProvider>
  );
  const view = render(tree(first));
  drag(icon(view, "Explorer"), 100, 150);

  // Another identity's store arrives before the first read finishes: the
  // move belonged to the old layout, and the old read lands too late.
  view.rerender(tree(second));
  expect(icon(view, "Explorer").style.left).toBe(`${originX}px`);
  await act(async () =>
    second.resolveRead(
      JSON.stringify({ icons: { notes: { x: 400, y: 40 } }, version: 1 }),
    ),
  );
  await act(async () =>
    first.resolveRead(
      JSON.stringify({ icons: { explorer: { x: 900, y: 900 } }, version: 1 }),
    ),
  );
  expect(icon(view, "Explorer").style.left).toBe(`${originX}px`);
  expect(icon(view, "Notes").style.left).toBe("400px");
  expect(first.writes).toEqual([]);
  expect(second.writes).toEqual([]);

  drag(icon(view, "Explorer"), 100, 130);
  await waitFor(() => expect(second.writes).toHaveLength(1));
  expect(JSON.parse(second.writes[0] ?? "null").icons).toEqual({
    explorer: { x: originX + 30, y: originY + 30 },
    notes: { x: 400, y: 40 },
  });
  expect(first.writes).toEqual([]);
});

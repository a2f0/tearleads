import { afterEach, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useMemo } from "react";
import { Menu } from "../menu/Menu";
import { MenuItem } from "../menu/MenuItem";
import { Window } from "./Window";
import { useWindowToolbarReservation } from "./WindowMenuContext";
import {
  useRegisteredWindowSidebar,
  useWindowSidebar,
} from "./WindowSidebarContext";
import {
  useWindowActions,
  useWindowStateData,
  WindowStateProvider,
} from "./WindowStateProvider";

// Every stylesheet the package ships, as a host page with no reset of its own
// receives them.
const sourceRoot = join(import.meta.dir, "..");
const stylesheets = readdirSync(sourceRoot, { recursive: true })
  .map(String)
  .filter((file) => file.endsWith(".css"))
  .map((file) => readFileSync(join(sourceRoot, file), "utf8"))
  .join("\n");

afterEach(() => {
  cleanup();
  document.head.replaceChildren();
});

function NotesContent() {
  return <p>notes</p>;
}

function LibraryContent() {
  const { setSidebar } = useWindowSidebar();
  const sidebar = useMemo(() => <nav>Folders</nav>, []);
  useRegisteredWindowSidebar({ setSidebar, sidebar });
  useWindowToolbarReservation();
  return <p>library</p>;
}

function Desktop() {
  const { windows } = useWindowStateData();
  const { create } = useWindowActions();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          create("Notes", 0, 0, NotesContent);
          create("Library", 40, 40, LibraryContent);
        }}
      >
        Open windows
      </button>
      {windows.map((entry) => (
        <Window key={entry.id} windowId={entry.id} />
      ))}
      <Menu position={{ x: 10, y: 10 }} onClose={() => {}}>
        <MenuItem label="Rename" onClick={() => {}} />
      </Menu>
    </>
  );
}

// box-sizing does not inherit, so an element the stylesheets miss lays out
// content-box under a host without a reset: a padded 100% box overflows.
test("the chrome lays out border-box without a host reset", () => {
  const style = document.createElement("style");
  style.textContent = stylesheets;
  document.head.append(style);
  const view = render(
    <WindowStateProvider>
      <Desktop />
    </WindowStateProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "Open windows" }));
  const [fileMenu] = view.getAllByText("File");
  if (!fileMenu) throw new Error("menu bar not rendered");
  fireEvent.click(fileMenu);

  const rendered = [
    ...document.querySelectorAll(".window, .window *, .menu, .menu *"),
  ];
  const classes = rendered.map((element) => element.className);
  for (const part of [
    "window-body-content-scroll",
    "window-sidebar-content-scroll",
    "window-toolbar",
    "window-menubar-dropdown",
    "menu",
  ]) {
    expect(classes).toContain(part);
  }
  const contentBox = rendered
    .filter((element) => getComputedStyle(element).boxSizing !== "border-box")
    .map((element) => `${element.tagName} ${element.className}`);
  expect(contentBox).toEqual([]);
});

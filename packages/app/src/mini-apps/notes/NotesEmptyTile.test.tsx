import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT,
  MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
} from "../../components/mini-app/virtual/MiniAppVirtual";
import { TOUCH_ROW_HEIGHT } from "../../navigation/useTouchRowHeight";
import { NOTES_LABELS } from "./labels";
import { NotesEmptyTile } from "./NotesEmptyTile";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-navigation-mode");
});

function rowHeightOf(tile: HTMLElement): string {
  return tile.style.getPropertyValue("--mini-app-virtual-row-height");
}

test("empty tile keeps the full sentence as its accessible name in both surfaces", () => {
  const rail = render(
    <NotesEmptyTile
      createNote={() => {}}
      onContextMenu={() => {}}
      rowHeight={MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT}
      showFullLabel={false}
    />,
  );

  // The narrow rail shows the action alone, but still announces the sentence —
  // which contains the visible label.
  expect(
    rail.getByRole("button", { name: NOTES_LABELS.sidebarEmptyCreate })
      .textContent,
  ).toBe(NOTES_LABELS.sidebarEmptyCreateShort);

  cleanup();

  const listHome = render(
    <NotesEmptyTile
      createNote={() => {}}
      onContextMenu={() => {}}
      rowHeight={MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT}
      showFullLabel
    />,
  );

  expect(
    listHome.getByRole("button", { name: NOTES_LABELS.sidebarEmptyCreate })
      .textContent,
  ).toBe(NOTES_LABELS.sidebarEmptyCreate);
});

test("empty tile opens the area context menu rather than swallowing it", () => {
  let areaMenus = 0;
  const view = render(
    <NotesEmptyTile
      createNote={() => {}}
      onContextMenu={() => {
        areaMenus += 1;
      }}
      rowHeight={MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT}
      showFullLabel
    />,
  );

  fireEvent.contextMenu(view.getByRole("button"));

  expect(areaMenus).toBe(1);
});

test("empty tile matches the row pitch of the list it stands in for", () => {
  const view = render(
    <NotesEmptyTile
      createNote={() => {}}
      onContextMenu={() => {}}
      rowHeight={MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT}
      showFullLabel={false}
    />,
  );
  expect(rowHeightOf(view.getByRole("button"))).toBe(
    `${MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT}px`,
  );

  cleanup();

  const roomy = render(
    <NotesEmptyTile
      createNote={() => {}}
      onContextMenu={() => {}}
      rowHeight={MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT}
      showFullLabel
    />,
  );
  expect(rowHeightOf(roomy.getByRole("button"))).toBe(
    `${MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT}px`,
  );
});

test("empty tile takes the touch row height in the routed layout", () => {
  document.documentElement.setAttribute("data-navigation-mode", "routed");
  const view = render(
    <NotesEmptyTile
      createNote={() => {}}
      onContextMenu={() => {}}
      rowHeight={MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT}
      showFullLabel={false}
    />,
  );

  expect(rowHeightOf(view.getByRole("button"))).toBe(`${TOUCH_ROW_HEIGHT}px`);
});

test("empty tile creates a note when clicked", () => {
  let created = 0;
  const view = render(
    <NotesEmptyTile
      createNote={() => {
        created += 1;
      }}
      onContextMenu={() => {}}
      rowHeight={MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT}
      showFullLabel
    />,
  );

  fireEvent.click(view.getByRole("button"));

  expect(created).toBe(1);
});

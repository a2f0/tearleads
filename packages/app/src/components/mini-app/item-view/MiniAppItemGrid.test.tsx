import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  getMiniAppItemGridColumns,
  getMiniAppItemGridItemWindow,
  MINI_APP_ITEM_GRID_ROW_HEIGHT,
  MiniAppItemGrid,
  MiniAppItemTile,
} from "./MiniAppItemGrid";

afterEach(() => cleanup());

function spacerHeights(container: HTMLElement): number[] {
  return [...container.querySelectorAll(".mini-app-virtual-block-spacer")].map(
    (spacer) => Number.parseFloat((spacer as HTMLElement).style.height),
  );
}

test("the column count fits tiles to the measured frame and waits for a measurement", () => {
  // Unmeasured: one column, so the first fetch stays small.
  expect(getMiniAppItemGridColumns(0)).toBe(1);
  // A 390px phone frame fits three 112px tiles with their gaps and padding.
  expect(getMiniAppItemGridColumns(390)).toBe(3);
  expect(getMiniAppItemGridColumns(1000)).toBe(8);
  // Never fewer than one, however narrow.
  expect(getMiniAppItemGridColumns(40)).toBe(1);
});

test("the item window covers whole lines of tiles", () => {
  expect(
    getMiniAppItemGridItemWindow({ columns: 4, limit: 24, offset: 3 }),
  ).toEqual({ limit: 96, offset: 12 });
  // A table line is one item, so the window passes through unchanged.
  expect(
    getMiniAppItemGridItemWindow({ columns: 1, limit: 24, offset: 3 }),
  ).toEqual({ limit: 24, offset: 3 });
});

test("spacers stand in for the lines outside the window", () => {
  const items = ["e", "f", "g", "h", "i"];
  const view = render(
    <MiniAppItemGrid
      aria-label="Items"
      columns={4}
      getItemKey={(item) => item}
      itemOffset={4}
      items={items}
      renderItem={(item) => <span>{item}</span>}
      status={null}
      totalCount={20}
    />,
  );

  // Line 0 is above the window; items 4–8 draw lines 1 and 2; lines 3 and 4
  // (items 12–19) are below it.
  expect(spacerHeights(view.container)).toEqual([
    MINI_APP_ITEM_GRID_ROW_HEIGHT,
    2 * MINI_APP_ITEM_GRID_ROW_HEIGHT,
  ]);
  expect(view.getByRole("list", { name: "Items" }).children).toHaveLength(5);
});

test("a window that starts mid-line places its first tile in its own column", () => {
  const view = render(
    <MiniAppItemGrid
      aria-label="Items"
      columns={4}
      getItemKey={(item) => item}
      itemOffset={6}
      items={["g", "h", "i"]}
      renderItem={(item) => <span>{item}</span>}
      status={null}
      totalCount={9}
    />,
  );

  const [first, second] = view.getAllByRole("listitem");
  expect(first?.style.gridColumnStart).toBe("3");
  expect(second?.style.gridColumnStart).toBe("");
  expect(spacerHeights(view.container)).toEqual([
    MINI_APP_ITEM_GRID_ROW_HEIGHT,
  ]);
});

test("an empty window shows its status instead of tiles", () => {
  const view = render(
    <MiniAppItemGrid
      aria-label="Items"
      columns={3}
      getItemKey={(item: string) => item}
      itemOffset={0}
      items={[]}
      renderItem={(item) => <span>{item}</span>}
      status="No items."
      totalCount={0}
    />,
  );

  expect(view.getByText("No items.")).toBeTruthy();
  expect(spacerHeights(view.container)).toEqual([]);
});

test("a tile is one named button that opens on click and on right-click opens its menu", () => {
  const events: string[] = [];
  const view = render(
    <MiniAppItemTile
      label="Quarterly report"
      onClick={() => events.push("open")}
      onContextMenu={() => events.push("menu")}
      selected
      visual={<svg aria-hidden="true" />}
    />,
  );

  const tile = view.getByRole("button", { name: "Quarterly report" });
  expect(tile.classList.contains("mini-app-item-tile--selected")).toBe(true);
  expect(tile.querySelector(".mini-app-item-thumb")).toBeTruthy();
  fireEvent.click(tile);
  fireEvent.contextMenu(tile);
  expect(events).toEqual(["open", "menu"]);
});

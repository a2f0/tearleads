import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./appTest";
import { switchToWindowedDesktop } from "./windowedDesktop";

/*
 * A list table with sortable headings lets its reader drag the edge between two
 * columns. The claims are about what the browser lays out, so this measures the
 * drawn headings: the edge follows the pointer, only the two columns beside it
 * change, the table keeps filling its frame without scrolling sideways, and
 * the chosen widths survive a reload. Explorer's item list stands for the
 * shared table (`MiniAppTable` with `columnWidths`) in both of its hosts.
 */

const ITEMS_LABEL = /^Items in /u;
const NAME_TYPE = "Resize Name and Type columns";
const TYPE_MODIFIED = "Resize Type and Date modified columns";

interface Layout {
  readonly frameOverflow: number;
  /** Whether the first row's date is cut short by its column. */
  readonly dateClipped: boolean;
  readonly modified: { left: number; width: number };
  readonly name: { left: number; width: number };
  readonly rowHeight: number;
  readonly sorted: string | null;
  readonly tableWidth: number;
  readonly type: { left: number; width: number };
}

async function measure(table: Locator): Promise<Layout> {
  return table.evaluate((element) => {
    const frame = element.closest(".mini-app-table-frame");
    const [name, type, modified] = Array.from(
      element.querySelectorAll("thead th"),
    );
    const row = element.querySelector("tbody tr.explorer-item-table-row");
    const date = row?.children[2];
    if (!frame || !name || !type || !modified || !row || !date) {
      throw new Error("Expected a framed table with three data columns.");
    }

    const box = (cell: Element) => {
      const rect = cell.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    };
    return {
      dateClipped: date.scrollWidth > date.clientWidth,
      frameOverflow: frame.scrollWidth - frame.clientWidth,
      modified: box(modified),
      name: box(name),
      rowHeight: row.getBoundingClientRect().height,
      sorted: name.getAttribute("aria-sort"),
      tableWidth: element.getBoundingClientRect().width,
      type: box(type),
    };
  });
}

/** Widths are stored as whole pixels, so a measurement may be one off. */
function expectNear(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
}

/** Presses on a handle's middle, moves by `delta` in steps, and lets go. */
async function dragHandle(page: Page, handle: Locator, delta: number) {
  const box = await handle.boundingBox();
  if (!box) {
    throw new Error("Expected a rendered resize handle.");
  }

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y + 40, { steps: 8 });
  await page.mouse.up();
}

async function openItemTable(page: Page, host: "pane" | "window") {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/app/explorer");
  if (host === "window") {
    await switchToWindowedDesktop(page);
  }

  return itemTable(page);
}

/** The item list once its headings and its first row are drawn. */
async function itemTable(page: Page) {
  const table = page.getByRole("table", { name: ITEMS_LABEL });
  await expect(
    table.getByRole("separator", { name: TYPE_MODIFIED }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    table.locator("tbody tr.explorer-item-table-row").first(),
  ).toBeVisible({ timeout: 30_000 });
  return table;
}

/**
 * The handle straddles the edge and takes the pointer on both sides of it: the
 * half reaching over the left-hand heading is not covered by that heading.
 */
async function expectHandleTakesPointer(
  page: Page,
  handle: Locator,
  edge: number,
) {
  const box = await handle.boundingBox();
  if (!box) {
    throw new Error("Expected a rendered resize handle.");
  }
  for (const offset of [-3, 3]) {
    const hit = await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.getAttribute("aria-label") ?? null,
      { x: edge + offset, y: box.y + box.height / 2 },
    );
    expect(hit).toBe(TYPE_MODIFIED);
  }
}

/** Drags both edges and returns the layout the drags left behind. */
async function dragEdges(page: Page, table: Locator, before: Layout) {
  const typeModified = table.getByRole("separator", { name: TYPE_MODIFIED });
  const nameType = table.getByRole("separator", { name: NAME_TYPE });

  // Between two measured columns: the left one takes what the right gives.
  await dragHandle(page, typeModified, 60);
  const traded = await measure(table);
  expectNear(traded.modified.left - before.modified.left, 60);
  expectNear(traded.type.width - before.type.width, 60);
  expectNear(traded.modified.width - before.modified.width, -60);
  expectNear(traded.name.width, before.name.width);
  expectNear(traded.type.left, before.type.left);
  expectNear(traded.tableWidth, before.tableWidth);
  expect(traded.frameOverflow).toBe(0);
  // Dragging an edge is not a click on a heading: the sort is untouched.
  expect(traded.sorted).toBe(before.sorted);
  // A narrowed column cuts its text short rather than wrapping it, so the
  // rows keep the pitch the virtualized list is measured by.
  expect(traded.dateClipped).toBe(true);
  expect(traded.rowHeight).toBe(before.rowHeight);

  // Beside the fill column: the edge still follows the pointer, and the
  // column that takes the table's slack gives up what its neighbour gains.
  await dragHandle(page, nameType, -50);
  const filled = await measure(table);
  expectNear(filled.type.left - traded.type.left, -50);
  expectNear(filled.type.width - traded.type.width, 50);
  expectNear(filled.name.width - traded.name.width, -50);
  expectNear(filled.modified.left, traded.modified.left);
  expectNear(filled.modified.width, traded.modified.width);
  expectNear(filled.tableWidth, before.tableWidth);
  expect(filled.frameOverflow).toBe(0);

  // Dragged as far as it goes, the fill column stops at its floor (10rem, a
  // length the windowed and routed layouts size differently) rather than
  // letting the table outgrow its frame and scroll sideways.
  const nameFloor = await page.evaluate(
    () =>
      10 *
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  await dragHandle(page, nameType, -2000);
  const floored = await measure(table);
  expectNear(floored.name.width, nameFloor);
  expect(floored.type.width).toBeGreaterThan(filled.type.width);
  expectNear(floored.modified.width, filled.modified.width);
  expectNear(floored.tableWidth, before.tableWidth);
  expect(floored.frameOverflow).toBe(0);
  for (const attribute of ["aria-valuenow", "aria-valuemin"]) {
    await expect(nameType).toHaveAttribute(
      attribute,
      String(Math.round(nameFloor)),
    );
  }
  return floored;
}

for (const host of ["pane", "window"] as const) {
  test(`dragging a column edge resizes the two columns beside it (${host})`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const table = await openItemTable(page, host);
    const before = await measure(table);
    // At its declared width a date column shows the whole date on one line.
    expect(before.dateClipped).toBe(false);
    await expectHandleTakesPointer(
      page,
      table.getByRole("separator", { name: TYPE_MODIFIED }),
      before.modified.left,
    );
    // A heading holding a handle is still named by its own content.
    await expect(
      table.getByRole("columnheader", { exact: true, name: "Type" }),
    ).toBeVisible();

    const dragged = await dragEdges(page, table, before);

    // The chosen widths are a stored preference.
    await page.reload();
    const reloadedTable = await itemTable(page);
    const reloadedHandle = reloadedTable.getByRole("separator", {
      name: TYPE_MODIFIED,
    });
    const reloaded = await measure(reloadedTable);
    expectNear(reloaded.type.width, dragged.type.width);
    expectNear(reloaded.modified.width, dragged.modified.width);

    // The keyboard moves a focused handle ten pixels at a time.
    await reloadedHandle.focus();
    await page.keyboard.press("ArrowLeft");
    const nudged = await measure(reloadedTable);
    expectNear(nudged.type.width - reloaded.type.width, -10);
    expectNear(nudged.modified.width - reloaded.modified.width, 10);
    await expect(reloadedHandle).toHaveAttribute(
      "aria-valuenow",
      String(Math.round(nudged.type.width)),
    );

    // Double-clicking each edge gives its columns back their declared widths.
    await reloadedHandle.dblclick();
    await reloadedTable.getByRole("separator", { name: NAME_TYPE }).dblclick();
    const reset = await measure(reloadedTable);
    expectNear(reset.type.width, before.type.width);
    expectNear(reset.modified.width, before.modified.width);
    expectNear(reset.name.width, before.name.width);
  });
}

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./appTest";

const ITEMS_LABEL = /^Items in /u;

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Expected a rendered box.");
  }
  return box;
}

async function rowGeometry(row: Locator) {
  return row.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    pitch: Number.parseFloat(
      getComputedStyle(element).getPropertyValue(
        "--mini-app-virtual-row-height",
      ),
    ),
  }));
}

async function switchView(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}

// Creating a folder opens it, so each one starts again from the root listing.
async function createRootFolders(page: Page, names: ReadonlyArray<string>) {
  for (const name of names) {
    await page.goto("/app/explorer");
    const create = page.getByRole("button", {
      name: "Create Child Folder",
      exact: true,
    });
    await expect(create).toBeEnabled({ timeout: 30_000 });
    await create.click();
    const dialog = page.getByRole("dialog", { name: "Create Child Folder" });
    await dialog.getByRole("textbox", { name: "Container name" }).fill(name);
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Folder actions: ${name}` }),
    ).toBeVisible({ timeout: 30_000 });
  }
}

test("the Explorer item list switches between small rows, large rows, and a grid", async ({
  page,
}) => {
  // Eight app loads: one per folder, then a visit and a reload at each width.
  test.setTimeout(90_000);
  // Enough items beside Contacts for a phone grid to wrap onto a second line.
  await createRootFolders(page, ["Alpha", "Bravo", "Charlie", "Delta"]);

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/app/explorer");

    const table = page.getByRole("table", { name: ITEMS_LABEL });
    const firstRow = table.locator("tbody tr.explorer-item-table-row").first();
    await expect(firstRow).toBeVisible({ timeout: 30_000 });
    const small = await rowGeometry(firstRow);

    // Large rows: the shared 96px pitch and an 80px square visual.
    await switchView(page, "Switch to large rows");
    await expect
      .poll(async () => (await rowGeometry(firstRow)).height)
      .toBeCloseTo(96, 0);
    expect((await rowGeometry(firstRow)).pitch).toBe(96);
    const thumb = await boxOf(firstRow.locator(".mini-app-item-thumb"));
    expect(thumb.width).toBeCloseTo(80, 0);
    expect(thumb.height).toBeCloseTo(thumb.width, 0);
    // The glyph fills the square, over the touch layout's 24px icon size.
    const glyph = await boxOf(
      firstRow.locator(".mini-app-item-thumb > *").first(),
    );
    expect(glyph.width).toBeCloseTo(thumb.width, 0);

    // Grid: tiles laid out in as many columns as the window math counted, each
    // a fixed-height tile with a square visual, one line per pitch.
    await switchView(page, "Switch to grid");
    const grid = page.getByRole("list", { name: ITEMS_LABEL });
    await expect(grid).toBeVisible();
    await expect(table).toHaveCount(0);
    const tiles = grid.locator(".mini-app-item-tile");
    await expect(tiles.first()).toBeVisible();
    const tileCount = await tiles.count();
    expect(tileCount).toBeGreaterThan(1);
    const frameWidth = await page
      .locator(".explorer-item-grid-frame")
      .evaluate((frame) => frame.clientWidth);
    const expectedColumns = Math.max(1, Math.floor((frameWidth - 8) / 120));
    const boxes = await Promise.all(
      Array.from({ length: tileCount }, (_, index) => boxOf(tiles.nth(index))),
    );
    const [first] = boxes;
    if (!first) {
      throw new Error("Expected a first tile.");
    }
    const firstLine = boxes.filter((box) => Math.abs(box.y - first.y) < 1);
    expect(firstLine).toHaveLength(Math.min(tileCount, expectedColumns));
    for (const box of boxes) {
      expect(box.height).toBeCloseTo(128, 0);
      expect(box.width).toBeGreaterThanOrEqual(112);
    }
    const secondLine = boxes.find((box) => box.y > first.y + 1);
    if (secondLine) {
      expect(secondLine.y - first.y).toBeCloseTo(136, 0);
    }
    const visual = await boxOf(
      tiles.first().locator(".mini-app-item-tile-visual"),
    );
    expect(visual.width).toBeGreaterThanOrEqual(48);
    expect(visual.height).toBeCloseTo(visual.width, 0);

    // The choice survives a reload.
    await page.reload();
    await expect(grid).toBeVisible({ timeout: 30_000 });

    await switchView(page, "Switch to small rows");
    await expect(firstRow).toBeVisible();
    await expect
      .poll(async () => (await rowGeometry(firstRow)).height)
      .toBeCloseTo(small.height, 0);
  }
});

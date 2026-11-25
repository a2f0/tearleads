import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { createFirstIdentity } from "./createFirstIdentity";

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Expected a rendered box.");
  }
  return box;
}

async function switchView(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}

async function attachThumbnailToNewNote(page: Page) {
  await page.goto("/app/notes");
  await createFirstIdentity(page);
  // The empty-list action appears once the notes directory finishes loading.
  await page.getByRole("button", { name: "No notes. Create one" }).click();
  await expect(
    page.getByRole("textbox", { name: "Notes editor" }),
  ).toBeEditable();
  await page.locator(".note-document-file-input").setInputFiles({
    name: "thumbnail.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="60"><rect width="90" height="60"/></svg>',
    ),
  });
  await expect(
    page.getByRole("button", { name: "Open thumbnail.svg" }),
  ).toBeVisible();
}

// Large rows: the thumbnail grows, and its row is exactly one pitch tall, so
// the rows stay in step with the scroll spacers.
async function expectLargeRows(image: Locator, smallWidth: number) {
  await expect
    .poll(async () => (await image.boundingBox())?.width ?? 0)
    .toBeGreaterThan(smallWidth * 1.5);
  const geometry = await image.evaluate((img) => {
    const row = img.closest("tr");
    if (!row) throw new Error("Missing blob row");
    return {
      height: row.getBoundingClientRect().height,
      pitch: Number.parseFloat(
        getComputedStyle(row).getPropertyValue("--mini-app-virtual-row-height"),
      ),
    };
  });
  expect(geometry.height).toBeCloseTo(geometry.pitch, 0);
}

// The larger thumbnail widens only its own column: MIME keeps its width.
async function expectMimeColumnNotStretched(table: Locator) {
  const mime = await boxOf(
    table.getByRole("columnheader", { name: "MIME", exact: true }),
  );
  const size = await boxOf(
    table.getByRole("columnheader", { name: "Size", exact: true }),
  );
  expect(size.x - mime.x).toBeLessThanOrEqual(200);
}

// Grid: fixed-height tiles, each a square visual over the blob's name, with
// the image filling the square.
async function expectGridTile(grid: Locator) {
  const tile = grid.locator(".mini-app-item-tile").first();
  await expect(tile).toContainText("thumbnail.svg");
  const tileBox = await boxOf(tile);
  const visual = await boxOf(tile.locator(".mini-app-item-tile-visual"));
  const tileImage = await boxOf(
    tile.locator(".explorer-blob-browser-thumb-image"),
  );
  expect(tileBox.height).toBeCloseTo(128, 0);
  expect(visual.width).toBeGreaterThanOrEqual(48);
  expect(visual.height).toBeCloseTo(visual.width, 0);
  expect(tileImage.width).toBeCloseTo(visual.width, 0);
  expect(tileImage.height).toBeCloseTo(visual.height, 0);
}

test("the blob list switches between small rows, large rows, and a grid without losing row alignment", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await attachThumbnailToNewNote(page);
  await page.goto("/app/explorer/blobs");

  const table = page.getByRole("table", { name: "Blob Browser" });
  const grid = page.getByRole("list", { name: "Blob Browser" });
  const image = table.locator(".explorer-blob-browser-thumb-image").first();
  await expect(image).toBeVisible();
  // The view switch is the toolbar's only list control: the checkbox it
  // replaced and the hub's Sync shortcut are both gone.
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Sync", exact: true }),
  ).toHaveCount(0);

  for (const width of [390, 1440]) {
    const wide = width === 1440;
    await page.setViewportSize({ width, height: 844 });
    await expect(
      table.getByRole("columnheader", { name: "MIME", exact: true }),
    ).toHaveCount(wide ? 1 : 0);
    const small = await boxOf(image);

    await switchView(page, "Switch to large rows");
    await expectLargeRows(image, small.width);
    if (wide) {
      await expectMimeColumnNotStretched(table);
    }

    await switchView(page, "Switch to grid");
    await expect(grid).toBeVisible();
    await expect(table).toHaveCount(0);
    await expectGridTile(grid);
    if (wide) {
      // The choice survives a reload.
      await page.reload();
      await expect(grid).toBeVisible({ timeout: 30_000 });
    }

    await switchView(page, "Switch to small rows");
    await expect
      .poll(async () => (await image.boundingBox())?.width)
      .toBe(small.width);
  }
});

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./appTest";

/*
 * A list table's column headings stay at the top of the frame that scrolls it,
 * and they are opaque: the rows passing beneath must not show through. Both
 * claims are about what the browser paints — a heading faded with `opacity`
 * still has a background in the stylesheet — so this measures the heading's
 * box and compares its pixels before and after a row slides under it.
 *
 * The tracker index frame is not virtualized, so it also covers the shared
 * pinning rule reaching every framed table rather than only virtual ones.
 */

async function addWeightEntry(page: Page, weight: string) {
  await page.getByRole("button", { name: "Add Entry" }).click();
  await page.getByLabel("Quick add weight").fill(weight);
  await page.getByRole("button", { name: "Save Entry" }).click();
  await expect(page.getByRole("button", { name: "Add Entry" })).toBeVisible();
}

/**
 * The heading cells' drawn box, and the first body row's top, in page pixels.
 * Measured from the `<th>` cells: they are what pins, while the `<thead>` and
 * its row keep reporting their unscrolled place in the table's flow.
 */
async function measureHeading(table: Locator) {
  return table.evaluate((element) => {
    const frame = element.closest(".mini-app-table-frame");
    const cells = Array.from(element.querySelectorAll("thead th"), (cell) =>
      cell.getBoundingClientRect(),
    );
    const firstRow = element.querySelector("tbody tr");
    const [first] = cells;
    const last = cells.at(-1);
    if (!frame || !first || !last || !firstRow) {
      throw new Error("Expected a framed table with a heading and a row.");
    }

    const frameBox = frame.getBoundingClientRect();
    return {
      firstRowTop: firstRow.getBoundingClientRect().top,
      head: {
        height: first.height,
        width: last.right - first.left,
        x: first.left,
        y: first.top,
      },
      scrollportTop: frameBox.top + frame.clientTop,
      scrollTop: frame.scrollTop,
    };
  });
}

test("a scrolled table keeps an opaque heading pinned over its rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto("/app/explorer");

  const newDocument = page.getByRole("button", { name: "New Document" });
  await expect(newDocument).toBeVisible({ timeout: 30_000 });
  await newDocument.click();
  await page
    .getByRole("button", { name: /Weight/u })
    .first()
    .click();
  await addWeightEntry(page, "180");
  await addWeightEntry(page, "175");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();

  const table = page.getByRole("table", { name: "Entries" });
  await expect(table.locator("tbody tr")).toHaveCount(2);

  // Shrink the frame to the heading plus half a row, so the two rows overflow
  // it and the frame — not the page — is what scrolls.
  await table.evaluate((element) => {
    const frame = element.closest<HTMLElement>(".mini-app-table-frame");
    const head = element.querySelector("thead");
    const row = element.querySelector("tbody tr");
    if (!frame || !head || !row) {
      throw new Error("Expected a framed table with a heading and a row.");
    }
    const height =
      head.getBoundingClientRect().height +
      row.getBoundingClientRect().height / 2;
    frame.style.flex = "none";
    frame.style.height = `${height}px`;
    frame.style.maxHeight = "none";
  });
  // Rows tint on hover; keep the pointer off the table so only scrolling moves.
  await page.mouse.move(0, 0);

  const before = await measureHeading(table);
  expect(before.scrollTop).toBe(0);
  const unscrolled = await page.screenshot({ clip: before.head });

  await table.evaluate((element) => {
    const frame = element.closest(".mini-app-table-frame");
    if (!frame) {
      throw new Error("Expected the table frame.");
    }
    frame.scrollTop = frame.scrollHeight;
  });

  const after = await measureHeading(table);
  // The frame really scrolled, and the first row now sits under the heading.
  expect(after.scrollTop).toBeGreaterThan(0);
  expect(after.firstRowTop).toBeLessThan(after.head.y + after.head.height);
  // Pinned: the heading did not move with the rows.
  expect(after.head.y).toBeCloseTo(after.scrollportTop, 0);
  expect(after.head).toEqual(before.head);
  // Opaque: with a row beneath it, the heading paints exactly as it did over
  // nothing.
  expect(await page.screenshot({ clip: after.head })).toEqual(unscrolled);
});

import { expect, type Locator, type Page, test } from "@playwright/test";

/*
 * A tracker's index (list) view is one table with one set of sortable column
 * headers — the shape the Explorer's container listing has — rather than a stack
 * of cards each repeating its own field labels.
 *
 * Every assertion here measures what the browser draws, because "it is a table"
 * is exactly the claim a passing unit test cannot make: a card list can render
 * the same strings in the same order and still leave nothing lined up. So this
 * asserts that each row's nth cell occupies the identical box as the row above
 * it, and — at the phone width, where a real table is most likely to burst its
 * container — that nothing spills into horizontal scroll.
 */

function trackerTable(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("table", { name });
}

/**
 * The drawn geometry of every body cell, row by row. A genuine column grid gives
 * every row an identical list; a per-row layout (a card, a grid sized to its own
 * content) does not.
 */
async function measureRowColumns(
  table: Locator,
): Promise<Array<Array<{ left: number; width: number }>>> {
  return table.evaluate((element) =>
    Array.from(element.querySelectorAll("tbody tr")).map((row) =>
      Array.from(row.querySelectorAll("td")).map((cell) => {
        const box = cell.getBoundingClientRect();
        return { left: Math.round(box.left), width: Math.round(box.width) };
      }),
    ),
  );
}

async function expectColumnarRows(table: Locator, rowCount: number) {
  // One header row for the whole list, not one per entry.
  await expect(table.locator("thead tr")).toHaveCount(1);
  const rows = await measureRowColumns(table);
  expect(rows).toHaveLength(rowCount);
  const [first, ...rest] = rows;
  if (!first) {
    throw new Error("Expected at least one body row to measure.");
  }
  const headerCount = await table.locator("thead th").count();
  expect(first).toHaveLength(headerCount);
  for (const row of rest) {
    expect(row).toEqual(first);
  }
}

async function addWindowedReading(
  explorerWindow: Locator,
  systolic: string,
  diastolic: string,
) {
  await explorerWindow.getByRole("button", { name: "Add Reading" }).click();
  await explorerWindow.getByLabel("Quick add systolic").fill(systolic);
  await explorerWindow.getByLabel("Quick add diastolic").fill(diastolic);
  await explorerWindow.getByRole("button", { name: "Save Reading" }).click();
  await expect(
    explorerWindow.getByRole("button", { name: "Add Reading" }),
  ).toBeVisible();
}

test("windowed tracker index draws its readings as one column grid", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");

  const pane = page.locator(".pane:not(.pane-hidden)").first();
  await expect(pane).toBeVisible({ timeout: 30_000 });
  await pane.click({ button: "right", position: { x: 120, y: 120 } });
  await page.getByRole("button", { name: "Explorer" }).first().click();

  const explorerWindow = page.locator(".window").first();
  const toolbar = explorerWindow.locator(".window-toolbar");
  await expect(
    toolbar.getByRole("button", { name: "New Document" }),
  ).toBeVisible({ timeout: 30_000 });
  await toolbar.getByRole("button", { name: "New Document" }).click();
  await explorerWindow
    .getByRole("button", { name: /Blood Pressure/u })
    .first()
    .click();

  await addWindowedReading(explorerWindow, "120", "80");
  await addWindowedReading(explorerWindow, "118", "76");
  // Leave edit mode: the index table is read mode's presentation of the rows.
  await toolbar.getByRole("button", { name: "Save" }).click();
  await expect(toolbar.getByRole("button", { name: "Edit" })).toBeVisible();

  const table = trackerTable(explorerWindow, "Readings");
  await expect(table).toBeVisible();
  await expectColumnarRows(table, 2);

  // Sorting is the header's, and it reorders the rows in place rather than
  // renumbering them: the ordinal names the reading, not its row.
  await expect(
    explorerWindow.locator("th[aria-sort='ascending']").getByText("#"),
  ).toBeVisible();
  await table.getByRole("button", { exact: true, name: "Reading" }).click();
  await expect(table.locator("tbody tr").first()).toContainText("118/76 mmHg");
  await expect(table.locator("tbody tr").first()).toContainText("2");
});

test("routed tracker index folds on a phone and unfolds on a tablet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/explorer");

  const newDocument = page.getByRole("button", { name: "New Document" });
  await expect(newDocument).toBeVisible({ timeout: 30_000 });
  await newDocument.click();
  await page
    .getByRole("button", { name: /Weight/u })
    .first()
    .click();
  await page.getByRole("button", { name: "Add Entry" }).click();
  await page.getByLabel("Quick add weight").fill("180");
  await page.getByRole("button", { name: "Save Entry" }).click();
  await expect(page.getByRole("button", { name: "Add Entry" })).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();

  const table = trackerTable(page, "Entries");
  await expect(table).toBeVisible();

  // Phone: the columns fold into one summary cell plus the kebab, and the table
  // stays inside its frame — the failure a bounding box alone would miss, since
  // an overflowing table still measures as wide as it wants to be.
  await expect(table.locator("thead th")).toHaveCount(2);
  await expect(table.locator("tbody tr").first().locator("td")).toHaveCount(2);
  const overflow = await page.evaluate(() => {
    const frame = document.querySelector(".tracker-read-table");
    if (!frame) {
      throw new Error("Expected the tracker index table frame.");
    }

    return {
      frameOverflow: frame.scrollWidth - frame.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  expect(overflow.frameOverflow).toBeLessThanOrEqual(1);
  expect(overflow.pageOverflow).toBeLessThanOrEqual(1);

  // Tablet/iPad: the same table takes its full column set back, still columnar.
  await page.setViewportSize({ width: 900, height: 1000 });
  await expect(
    table.getByRole("columnheader", { name: "Weight" }),
  ).toBeVisible();
  await expect(
    table.getByRole("columnheader", { name: "Measured" }),
  ).toBeVisible();
  await expectColumnarRows(table, 1);
});

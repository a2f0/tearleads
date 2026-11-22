import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./appTest";

/*
 * A list table's column headings stay at the top of the frame that scrolls it,
 * and they are opaque: the rows passing beneath must not show through. Both
 * claims are about what the browser paints — a heading faded with `opacity`
 * still has a background in the stylesheet — so this measures the heading's
 * box and compares its pixels before and after a row slides under it.
 *
 * The heading's bottom divider has to ride along too: a collapsed table border
 * belongs to the table's grid, not the pinned cell, and stays behind in the
 * flow. The tracker index frame is not virtualized, so this also covers the
 * shared pinning rule reaching every framed table rather than only virtual ones.
 */

type Box = { height: number; width: number; x: number; y: number };

async function addWeightEntry(page: Page, ordinal: number, weight: string) {
  await page.getByRole("button", { name: "Add Entry" }).click();
  await page.getByLabel("Quick add weight").fill(weight);
  // Exact, because a row that has not finished saving still carries its own
  // "Save entry 1", which a substring match collides with.
  await page.getByRole("button", { exact: true, name: "Save Entry" }).click();
  // Wait for the row's saved presentation, not merely for the form to close,
  // so the next entry is never added beside a still-saving one.
  await expect(
    page.getByRole("button", { name: `Entry ${ordinal} actions` }),
  ).toBeVisible();
}

async function scrollFrame(table: Locator, top: number) {
  await table.evaluate((element, scrollTop) => {
    const frame = element.closest(".mini-app-table-frame");
    if (!frame) {
      throw new Error("Expected the table frame.");
    }
    frame.scrollTop = scrollTop;
  }, top);
}

/**
 * The page rows, in a thin band straddling the heading's foot, painted pure
 * red, the colour the test gives the heading's bottom border and nothing
 * else on the page uses.
 */
async function findRedRowsAtHeadingFoot(page: Page, head: Box) {
  const band = {
    height: 6,
    width: 16,
    x: Math.round(head.x) + 4,
    y: Math.floor(head.y + head.height) - 3,
  };
  const png = await page.screenshot({ clip: band });
  const redRows = await page.evaluate(
    async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Expected a 2D canvas context.");
      }
      context.drawImage(image, 0, 0);
      const rows: number[] = [];
      for (let row = 0; row < image.height; row += 1) {
        const [red = 0, green = 0, blue = 0] = context.getImageData(
          Math.floor(image.width / 2),
          row,
          1,
          1,
        ).data;
        if (red > 200 && green < 80 && blue < 80) {
          rows.push(row);
        }
      }
      return rows;
    },
    `data:image/png;base64,${png.toString("base64")}`,
  );
  return redRows.map((row) => band.y + row);
}

/**
 * The heading cells' drawn box, and the first body row's top, in page pixels.
 * Measured from the `<th>` cells: they are what pins, while the `<thead>` and
 * its row keep reporting their unscrolled place in the table's flow.
 */
async function measureHeading(table: Locator): Promise<{
  firstRowTop: number;
  head: Box;
  scrollportTop: number;
  scrollTop: number;
}> {
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
  await addWeightEntry(page, 1, "180");
  await addWeightEntry(page, 2, "175");
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

  await scrollFrame(table, Number.MAX_SAFE_INTEGER);

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

  // Divided: the heading's bottom border stays at its foot while pinned. Paint
  // it a colour no row uses, then find it in the same place scrolled and not.
  await page.addStyleTag({
    content:
      ".mini-app-table thead th { border-bottom-color: rgb(255, 0, 0) !important; }",
  });
  const pinnedDivider = await findRedRowsAtHeadingFoot(page, after.head);
  await scrollFrame(table, 0);
  expect(pinnedDivider).not.toHaveLength(0);
  expect(pinnedDivider).toEqual(
    await findRedRowsAtHeadingFoot(page, before.head),
  );
});

import type { Page } from "@playwright/test";
import { expect, test } from "./appTest";

/*
 * The "Hide table divider lines" feature flag clears the line between one row
 * and the next in every list, without moving anything: each row keeps its
 * border, now transparent, so its height and a virtual list's row pitch hold.
 * The heading's rule is not a row divider and stays. On a phone the last row
 * also draws a line marking the list's end, which goes with the others.
 * Measured on Explorer's item list, which draws its rows through the shared
 * table styles, with a note added so a line runs between two rows.
 */

const FLAG_STORAGE_KEY = "tearleads.feature-flags:hide-table-divider-lines";
const TRANSPARENT = "rgba(0, 0, 0, 0)";

interface Line {
  readonly color: string;
  readonly width: string;
}

interface Lines {
  readonly betweenRows: Line;
  readonly headingRule: string;
  readonly listEnd: Line;
  readonly rowHeight: number;
}

async function addNote(page: Page): Promise<void> {
  await page.goto("/app/explorer");
  await page
    .getByRole("button", { name: "New Document" })
    .first()
    .click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Notes editor" }),
  ).toBeEditable({ timeout: 30_000 });
}

async function measureLines(
  page: Page,
  width: number,
  hidden: boolean,
): Promise<Lines> {
  await page.evaluate(
    ([key, hide]) => {
      if (hide) {
        localStorage.setItem(key, "enabled");
      } else {
        localStorage.removeItem(key);
      }
    },
    [FLAG_STORAGE_KEY, hidden] as const,
  );
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/app/explorer");
  const rows = page.locator(
    ".explorer-item-table-wrap tbody tr.explorer-item-table-row",
  );
  await expect(rows).toHaveCount(2, { timeout: 30_000 });
  return page.locator(".explorer-item-table-wrap").evaluate((frame) => {
    const heading = frame.querySelector("thead th");
    const [first, last] = Array.from(
      frame.querySelectorAll("tbody tr.explorer-item-table-row td:first-child"),
    );
    if (!heading || !first || !last) {
      throw new Error("Expected a listing with a heading and two rows.");
    }
    const line = (cell: Element) => {
      const style = getComputedStyle(cell);
      return { color: style.borderBottomColor, width: style.borderBottomWidth };
    };
    return {
      betweenRows: line(first),
      headingRule: getComputedStyle(heading).borderBottomColor,
      listEnd: line(last),
      rowHeight: first.getBoundingClientRect().height,
    };
  });
}

test("hiding table divider lines clears row lines and keeps the heading rule", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await addNote(page);

  const tablet = await measureLines(page, 1280, false);
  expect(tablet.betweenRows.color).not.toBe(TRANSPARENT);
  expect(tablet.headingRule).not.toBe(TRANSPARENT);

  const tabletHidden = await measureLines(page, 1280, true);
  expect(tabletHidden.betweenRows.color).toBe(TRANSPARENT);
  expect(tabletHidden.headingRule).toBe(tablet.headingRule);
  // Nothing moved: the line is still there, only unpainted.
  expect(tabletHidden.betweenRows.width).toBe(tablet.betweenRows.width);
  expect(tabletHidden.rowHeight).toBe(tablet.rowHeight);

  const phone = await measureLines(page, 390, false);
  expect(phone.listEnd.color).not.toBe(TRANSPARENT);
  expect(phone.listEnd.width).not.toBe("0px");

  const phoneHidden = await measureLines(page, 390, true);
  expect(phoneHidden.betweenRows.color).toBe(TRANSPARENT);
  expect(phoneHidden.listEnd.color).toBe(TRANSPARENT);
  expect(phoneHidden.listEnd.width).toBe(phone.listEnd.width);
  expect(phoneHidden.headingRule).toBe(phone.headingRule);
});

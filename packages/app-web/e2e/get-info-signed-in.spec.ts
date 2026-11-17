import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import {
  getInfoTable,
  getInfoTableRows,
  openContainerInfoTab,
  openDocumentInfoTab,
  PHONE_VIEWPORT,
  SIGNED_IN_FOLDER,
  SIGNED_IN_NOTE,
  seedSignedInGetInfo,
  showEditRanges,
} from "./signedInGetInfo";
import { SIGNED_IN_APP_URL } from "./signedInServer";

/*
 * Get Info's multi-column tables on a signed-in phone. With three to six
 * columns in about 358px they could not fit, so on a phone each folds into
 * two-line rows: a primary line over a muted secondary line. Measured from what
 * the browser draws — the columns in the header, the lines each row's text
 * lands on, and whether the table scrolls or reaches past its pane — since a
 * fold that silently stops firing still renders every value, just unreadably.
 *
 * Signing in and creating the folder and note the tables describe is the slow
 * part, so one page is seeded once and every test reopens Get Info on it.
 */

const PHONE_WIDTHS = [390, 320] as const;

test.use({ baseURL: SIGNED_IN_APP_URL, viewport: PHONE_VIEWPORT });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  context = await browser.newContext({ viewport: PHONE_VIEWPORT });
  page = await context.newPage();
  await seedSignedInGetInfo(page);
});

test.afterAll(async () => {
  await context.close();
});

interface DrawnTable {
  /** Header cells: a folded table has its summary and at most a kebab. */
  columns: number;
  /** How far the table's frame scrolls sideways, in px. */
  overflow: number;
  /** How far the frame reaches past its scrollport's content box, in px. */
  overhang: number;
  /** For each body row, the distinct lines its text was drawn on. */
  rowLines: number[];
}

/** Runs in the page, so it is self-contained. */
function measureTable(table: Element): DrawnTable {
  const frame = table.parentElement ?? table;
  let port = frame.parentElement;
  while (port && getComputedStyle(port).overflowX === "visible") {
    port = port.parentElement;
  }
  const portBox = port?.getBoundingClientRect();
  const portStyle = port ? getComputedStyle(port) : null;
  const frameBox = frame.getBoundingClientRect();
  const overhang =
    port && portBox && portStyle
      ? Math.max(
          0,
          frameBox.right -
            (portBox.left +
              Number.parseFloat(portStyle.borderLeftWidth) +
              port.clientWidth -
              Number.parseFloat(portStyle.paddingRight)),
        )
      : 0;

  const range = document.createRange();
  const linesOf = (row: Element) => {
    const tops: number[] = [];
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      range.selectNodeContents(text);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width > 0) tops.push(rect.top);
      }
    }
    // Text of different sizes on one line sits a pixel or two apart.
    tops.sort((a, b) => a - b);
    return tops.filter(
      (top, index) => index === 0 || top - (tops[index - 1] ?? top) > 4,
    ).length;
  };

  return {
    columns: table.querySelectorAll("thead th").length,
    overflow: frame.scrollWidth - frame.clientWidth,
    overhang: Math.round(overhang),
    rowLines: Array.from(table.querySelectorAll("tbody > tr")).map(linesOf),
  };
}

async function expectFolded(table: Locator): Promise<void> {
  await expect(table).toBeVisible({ timeout: 30_000 });
  await expect(getInfoTableRows(table).first()).toBeVisible({
    timeout: 30_000,
  });
  const drawn = await table.evaluate(measureTable);

  expect(drawn.columns).toBeLessThanOrEqual(2);
  expect(drawn.overflow).toBe(0);
  expect(drawn.overhang).toBe(0);
  expect(drawn.rowLines.length).toBeGreaterThan(0);
  expect(drawn.rowLines.filter((lines) => lines !== 2)).toEqual([]);
}

const TABLES = [
  {
    name: "container sharing grants",
    open: () => openContainerInfoTab(page, SIGNED_IN_FOLDER, "Sharing"),
    table: "grants",
  },
  {
    name: "container security path",
    open: () => openContainerInfoTab(page, SIGNED_IN_FOLDER, "Security"),
    table: "path",
  },
  {
    name: "container sync cursors",
    open: () => openContainerInfoTab(page, SIGNED_IN_FOLDER, "Sync"),
    table: "syncCursors",
  },
  {
    name: "document attachments",
    open: () =>
      openDocumentInfoTab(page, SIGNED_IN_FOLDER, SIGNED_IN_NOTE, "Blobs"),
    table: "attachments",
  },
  {
    name: "document edit ranges",
    open: async () => {
      await openDocumentInfoTab(
        page,
        SIGNED_IN_FOLDER,
        SIGNED_IN_NOTE,
        "Attribution",
      );
      await showEditRanges(page);
    },
    table: "editRanges",
  },
] as const;

for (const width of PHONE_WIDTHS) {
  for (const entry of TABLES) {
    test(`${entry.name} fold into two-line rows (${width}px)`, async () => {
      await page.setViewportSize({ ...PHONE_VIEWPORT, width });
      await entry.open();
      await expectFolded(getInfoTable(page, entry.table));
    });
  }
}

// Wide, the same tables keep their columns, each a fixed share of the frame.
// A value longer than its share must truncate inside its cell: drawn past the
// cell's edge it runs into the next column's value.
const WIDE_VIEWPORT = { width: 1280, height: 900 };

interface DrawnWideTable {
  columns: number;
  /** How far the table's frame scrolls sideways, in px. */
  overflow: number;
  /** Each body cell whose content is wider than the cell. */
  overflowingCells: string[];
}

/** Runs in the page, so it is self-contained. */
function measureWideTable(table: Element): DrawnWideTable {
  const frame = table.parentElement ?? table;
  const overflowingCells = Array.from(table.querySelectorAll("tbody td"))
    .filter((cell) => cell.scrollWidth > cell.clientWidth + 1)
    .map(
      (cell) =>
        `${(cell.textContent ?? "").trim()} (${cell.scrollWidth}px in ${cell.clientWidth}px)`,
    );
  return {
    columns: table.querySelectorAll("thead th").length,
    overflow: frame.scrollWidth - frame.clientWidth,
    overflowingCells,
  };
}

async function expectUnfolded(table: Locator): Promise<void> {
  await expect(table).toBeVisible({ timeout: 30_000 });
  await expect(getInfoTableRows(table).first()).toBeVisible({
    timeout: 30_000,
  });
  const drawn = await table.evaluate(measureWideTable);

  expect(drawn.columns).toBeGreaterThan(2);
  expect(drawn.overflowingCells).toEqual([]);
  expect(drawn.overflow).toBeLessThanOrEqual(0);
}

for (const entry of TABLES) {
  test(`${entry.name} keep columns that hold their values (${WIDE_VIEWPORT.width}px)`, async () => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await entry.open();
    await expectUnfolded(getInfoTable(page, entry.table));
  });
}

// A folded row truncates or drops values its wide columns show, and both keep
// full ids in tooltips a touch screen never shows. Every row of these tables
// opens a detail dialog instead. Grants are left out: a grant row opens its
// group or user.
const DETAIL_TABLES = TABLES.filter((entry) => entry.table !== "grants");

interface DrawnRowDetail {
  /** The dialog's fields, in order. */
  labels: string[];
  /** Each value the row holds that the dialog does not draw. */
  missing: string[];
  /** How many values the row holds. */
  values: number;
}

/**
 * Compares a row with the dialog it opened, both read in one pass so a sync
 * that refreshes a cursor cannot land between them. A row holds each text it
 * draws and each value in a tooltip; a text shortened with an ellipsis stands
 * for the full value in its tooltip. Each must be a field of the dialog. Runs
 * in the page, so it is self-contained.
 */
function measureRowDetail(row: Element): DrawnRowDetail {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  // Whole fields, not a search of the dialog's text: a storage key contains
  // its slot id, which must not stand in for the Slot field. A time is drawn
  // as "<as its row shows it> (<as recorded>)", so both halves count.
  const shown = new Set(
    Array.from(dialog?.querySelectorAll("dd") ?? []).flatMap((field) => {
      const text = (field.textContent ?? "").trim();
      return [text, ...text.replace(/\)$/u, "").split(" (")];
    }),
  );
  const texts: string[] = [];
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    texts.push((node.textContent ?? "").trim());
  }
  const tooltips = Array.from(
    row.querySelectorAll("[title]"),
    (titled) => titled.getAttribute("title") ?? "",
  );
  const values = new Set([
    ...texts.filter((text) => !text.includes("...")),
    // A tooltip can join several values: "<name> · <user id> · <key>".
    ...tooltips.flatMap((tooltip) => tooltip.split(/\s+/u)),
  ]);
  values.delete("");
  values.delete("·");

  return {
    labels: Array.from(
      dialog?.querySelectorAll("dt") ?? [],
      (label) => label.textContent ?? "",
    ),
    missing: Array.from(values).filter((value) => !shown.has(value)),
    values: values.size,
  };
}

interface DrawnDialog {
  /** Each value drawn wider than the room it has. */
  clipped: string[];
  labels: string[];
  /** How far the dialog reaches past the viewport on any side, in px. */
  overhang: number;
}

/** Runs in the page, so it is self-contained. */
function measureDialog(dialog: Element): DrawnDialog {
  const box = dialog.getBoundingClientRect();
  return {
    clipped: Array.from(dialog.querySelectorAll("dd"))
      .filter((value) => value.scrollWidth > value.clientWidth + 1)
      .map((value) => value.textContent ?? ""),
    labels: Array.from(
      dialog.querySelectorAll("dt"),
      (label) => label.textContent ?? "",
    ),
    overhang: Math.round(
      Math.max(
        0,
        -box.left,
        -box.top,
        box.right - window.innerWidth,
        box.bottom - window.innerHeight,
      ),
    ),
  };
}

async function firstRow(table: Locator): Promise<Locator> {
  await expect(table).toBeVisible({ timeout: 30_000 });
  const row = getInfoTableRows(table).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

for (const entry of DETAIL_TABLES) {
  test(`${entry.name}: a folded row opens every value its wide row holds`, async () => {
    // Wide, the row shows every value (some only in a tooltip), so the dialog
    // it opens there is measured against it.
    await page.setViewportSize(WIDE_VIEWPORT);
    await entry.open();
    const wideRow = await firstRow(getInfoTable(page, entry.table));
    // The last cell is plain text in every table, so this is the row's own
    // click rather than a control's (an attachment's Blob button leaves).
    await wideRow.locator("td").last().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const wide = await wideRow.evaluate(measureRowDetail);
    expect(wide.values).toBeGreaterThan(2);
    expect(wide.missing).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // On a phone the same dialog opens from a tap anywhere on the folded row,
    // here its second line, and draws every field whole inside the screen.
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ ...PHONE_VIEWPORT, width });
      await entry.open();
      const table = getInfoTable(page, entry.table);
      const row = await firstRow(table);
      await expectFolded(table);
      const rowBox = await row.boundingBox();
      if (!rowBox) throw new Error("The folded row is not drawn");
      await row.click({
        position: { x: rowBox.width / 2, y: rowBox.height - 10 },
      });
      await expect(dialog).toBeVisible();
      const drawn = await dialog.evaluate(measureDialog);
      expect(drawn.labels).toEqual(wide.labels);
      expect(drawn.clipped).toEqual([]);
      expect(drawn.overhang).toBe(0);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toBeHidden();
    }
  });
}

import { expect, type Locator, type Page, test } from "@playwright/test";

/*
 * Explorer Get Info on a phone. The key/value lists (MiniAppKeyValueList) set
 * each key beside its value on a wide pane, but beside the 20ch key column a
 * phone left a value about 15 characters at 390px and 8 at 320px: dates took
 * three lines, a pending-changes summary broke mid-word, and a shortened id
 * split at its hyphen. On a phone the key stacks above a full-width value.
 *
 * Everything here is measured from what the browser draws. A wrapped label, a
 * value broken mid-word, and a list wider than its pane all look correct in the
 * markup and the stylesheet; only the line boxes say how the text was laid out.
 * The measuring functions below run in the page, so each is self-contained.
 */

const PHONE_WIDTHS = [390, 320] as const;

interface DrawnRow {
  key: string;
  /** Line boxes the key was drawn on. */
  keyLines: number;
  /** Text around each line break in the value that did not fall on a space. */
  midWordBreaks: string[];
  /** Whether the value starts below its key rather than beside it. */
  stacked: boolean;
  /** Line boxes the value was drawn on. */
  valueLines: number;
}

interface DrawnPanel {
  /** How far any list reaches past its scrollport's content box, in px. */
  overhang: number;
  rows: DrawnRow[];
}

/** One rect per line fragment, so distinct tops count the drawn lines. */
function drawnLines(node: Element): number {
  const range = document.createRange();
  range.selectNodeContents(node);
  const tops = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0)
    .map((rect) => Math.round(rect.top));
  return new Set(tops).size;
}

/**
 * A line break is fine where the text has a space; anywhere else it split a
 * word or an id. Compare each visible character's line with the previous one's.
 */
function midWordBreaks(node: Element): string[] {
  const range = document.createRange();
  const glyphs: Array<{ char: string; top: number | null }> = [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    for (let index = 0; index < (text.textContent ?? "").length; index += 1) {
      range.setStart(text, index);
      range.setEnd(text, index + 1);
      const rect = range.getClientRects()[0];
      glyphs.push({ char: range.toString(), top: rect ? rect.top : null });
    }
  }

  const breaks: string[] = [];
  let previousTop: number | null = null;
  let afterSpace = false;
  glyphs.forEach((glyph, index) => {
    if (/\s/.test(glyph.char) || glyph.top === null) {
      afterSpace ||= /\s/.test(glyph.char);
      return;
    }
    if (previousTop !== null && glyph.top > previousTop + 1 && !afterSpace) {
      const around = glyphs.slice(Math.max(0, index - 8), index + 8);
      breaks.push(around.map((entry) => entry.char).join(""));
    }
    previousTop = glyph.top;
    afterSpace = false;
  });
  return breaks;
}

function startsBelowKey(value: Element): boolean {
  const key = value.previousElementSibling;
  return key !== null
    ? value.getBoundingClientRect().top >=
        key.getBoundingClientRect().bottom - 1
    : false;
}

/**
 * How far the list, or any value inside it, reaches past the content box of the
 * nearest ancestor that would scroll it sideways.
 */
function overhang(list: Element): number {
  let port = list.parentElement;
  while (port && getComputedStyle(port).overflowX === "visible") {
    port = port.parentElement;
  }
  if (!port) {
    return 0;
  }
  const style = getComputedStyle(port);
  const left =
    port.getBoundingClientRect().left +
    Number.parseFloat(style.borderLeftWidth) +
    Number.parseFloat(style.paddingLeft);
  const right =
    left +
    port.clientWidth -
    Number.parseFloat(style.paddingLeft) -
    Number.parseFloat(style.paddingRight);
  const box = list.getBoundingClientRect();
  const widest = Math.max(
    box.right,
    ...Array.from(list.querySelectorAll("dd")).map(
      (value) =>
        value.getBoundingClientRect().left +
        Math.max(value.scrollWidth, value.clientWidth),
    ),
  );
  return Math.round(Math.max(0, widest - right, left - box.left));
}

async function openDocumentInfo(page: Page): Promise<void> {
  await page.goto("/app/explorer");
  await page.getByRole("button", { name: "New Document" }).first().click();
  await page.getByRole("button", { name: "Blood Pressure" }).click();
  await page.getByRole("button", { name: "Get Info" }).first().click();
}

async function openContainerInfo(page: Page): Promise<void> {
  await page.goto("/app/explorer");
  const rowAction = page.getByRole("button", { name: "Actions for Contacts" });
  await expect(rowAction).toBeVisible({ timeout: 30_000 });
  await rowAction.click();
  await page.getByText("Get Info", { exact: true }).first().click();
}

async function measureRow(key: Locator): Promise<DrawnRow> {
  const value = key.locator("xpath=following-sibling::dd[1]");
  return {
    key: (await key.textContent()) ?? "",
    keyLines: await key.evaluate(drawnLines),
    midWordBreaks: await value.evaluate(midWordBreaks),
    stacked: await value.evaluate(startsBelowKey),
    valueLines: await value.evaluate(drawnLines),
  };
}

async function measureTabPanel(page: Page): Promise<DrawnPanel> {
  const panel = page.getByRole("tabpanel");
  const keys = panel.locator("dl dt");
  await expect(keys.first()).toBeVisible({ timeout: 30_000 });

  const rows: DrawnRow[] = [];
  for (const key of await keys.all()) {
    rows.push(await measureRow(key));
  }
  const overhangs: number[] = [];
  for (const list of await panel.locator("dl").all()) {
    overhangs.push(await list.evaluate(overhang));
  }
  return { overhang: Math.max(0, ...overhangs), rows };
}

function expectPhoneRows(drawn: DrawnPanel): void {
  expect(drawn.rows.length).toBeGreaterThan(0);
  expect(drawn.rows.filter((row) => !row.stacked)).toEqual([]);
  expect(drawn.rows.filter((row) => row.keyLines !== 1)).toEqual([]);
  expect(drawn.rows.flatMap((row) => row.midWordBreaks)).toEqual([]);
  expect(drawn.overhang).toBe(0);
}

for (const width of PHONE_WIDTHS) {
  test(`document info general stacks keys over whole values (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await openDocumentInfo(page);

    const drawn = await measureTabPanel(page);

    expectPhoneRows(drawn);
    // The point of stacking: at 390px a full-width value holds about 36
    // characters, so the dates, summaries, and shortened ids here each fit on
    // one line. 320px leaves about 29, which the pending-changes summary can
    // exceed, so there it only has to wrap at a space.
    if (width === 390) {
      expect(drawn.rows.filter((row) => row.valueLines !== 1)).toEqual([]);
    }
  });

  test(`document info security stacks keys over whole values (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await openDocumentInfo(page);
    await page.getByRole("tab", { name: "Security" }).click();

    expectPhoneRows(await measureTabPanel(page));
  });

  test(`container info general stacks keys over whole values (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await openContainerInfo(page);

    expectPhoneRows(await measureTabPanel(page));
  });

  // One row that scrolls sideways: wrapped, the strip left Document Info's
  // fifth tab alone on a second row, and the panel's top edge (the strip's
  // baseline) ran only under that row. A tap on a tab out of view has to bring
  // it fully into the strip, since nothing else scrolls it there on a touch
  // screen — so the tap is dispatched in the page, where Playwright's own
  // scroll-into-view cannot do that work for it.
  test(`document info tab strip stays on one row (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await openDocumentInfo(page);
    const strip = page.getByRole("tablist");
    await expect(strip.getByRole("tab")).toHaveCount(5, { timeout: 30_000 });

    const drawn = await strip.evaluate((element) => {
      const tabs = Array.from(element.querySelectorAll('[role="tab"]'));
      const tops = tabs.map((tab) =>
        Math.round(tab.getBoundingClientRect().top),
      );
      tabs.at(-1)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return {
        rows: new Set(tops).size,
        scrolls: element.scrollWidth > element.clientWidth,
      };
    });
    expect(drawn).toEqual({ rows: 1, scrolls: true });

    await expect(strip.getByRole("tab", { name: "Security" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect
      .poll(() =>
        strip.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const tab = element
            .querySelector('[aria-selected="true"]')
            ?.getBoundingClientRect();
          return tab
            ? tab.left >= box.left - 0.5 && tab.right <= box.right + 0.5
            : false;
        }),
      )
      .toBe(true);
  });
}

// Stacking is the narrow layout, not the only one: a wide pane keeps each key
// beside its value, in the one fixed key column that lines sibling lists up.
test("document info keeps keys beside values on a wide pane", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openDocumentInfo(page);

  const drawn = await measureTabPanel(page);

  expect(drawn.rows.length).toBeGreaterThan(0);
  expect(drawn.rows.filter((row) => row.stacked)).toEqual([]);
  expect(drawn.overhang).toBe(0);
});

// A shortened id keeps its full form for the copy alone; a touch screen never
// shows the tooltip. The value's row is its tap target: at least 44px tall,
// tappable edge to edge, and not one pixel into the next row — where a tap
// meant for one id must not copy its neighbour. Probed with elementFromPoint,
// since the target is an overlay and draws nothing, at a phone (stacked) and
// on a wide pane (side by side, where an id row is shorter than 44px unless it
// grows).
for (const width of [390, 1280]) {
  test(`document info copies a full id from its whole row (${width}px)`, async ({
    context,
    page,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width, height: 844 });
    await openDocumentInfo(page);

    const value = page.getByRole("button", { name: "Copy Local ID" });
    await expect(value).toBeVisible({ timeout: 30_000 });
    const reach = await value.evaluate((button) => {
      const row = button.closest("dd")?.parentElement;
      const next = row?.nextElementSibling;
      if (!row || !next) {
        return null;
      }
      const box = row.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const hits = (y: number) =>
        document.elementFromPoint(x, y)?.closest("button") === button;
      return {
        bottom: hits(box.bottom - 1),
        height: box.height >= 44,
        nextRow: hits(next.getBoundingClientRect().top + 1),
        top: hits(box.top + 1),
      };
    });
    expect(reach).toEqual({
      bottom: true,
      height: true,
      nextRow: false,
      top: true,
    });

    const full = await value.getAttribute("title");
    await value.click();
    expect(full).toMatch(/^[0-9a-f-]{36}$/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      full,
    );
  });
}

// Container General's "Container view" section ends in two help paragraphs. As
// flex items their own margins do not collapse, so they sat a double space
// apart; they should be spaced by the section's gap like everything else in it.
test("container info help paragraphs keep the section's spacing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openContainerInfo(page);

  // The innermost match: any enclosing section also contains the text.
  const section = page
    .getByRole("tabpanel")
    .locator("section", { hasText: "Container view" })
    .last();
  await expect(section.locator("p").nth(1)).toBeVisible({ timeout: 30_000 });
  const spacing = await section.evaluate((element) => {
    const [first, second] = Array.from(element.querySelectorAll(":scope > p"));
    if (!first || !second) {
      return null;
    }
    return {
      between: Math.round(
        second.getBoundingClientRect().top -
          first.getBoundingClientRect().bottom,
      ),
      gap: Math.round(Number.parseFloat(getComputedStyle(element).rowGap)),
    };
  });

  expect(spacing).not.toBeNull();
  expect(spacing?.between).toBe(spacing?.gap);
});

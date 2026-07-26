import { expect, test } from "@playwright/test";

/*
 * Routed-shell chrome geometry on a phone. These assert what the browser
 * actually draws — box positions, widths, computed type size — because every
 * value here is set in CSS on top of a JSX attribute that looks right on its
 * own, so a dropped override reads as correct in the source and wrong on the
 * screen. Split out of app.spec.ts, which had grown past the repo's file-size
 * budget; that file keeps the boot, routing, and persistence coverage, and none
 * of these tests use its pane helpers.
 */

test("mobile sidebar covers Explorer rows", async ({ page }) => {
  await page.setViewportSize({ width: 599, height: 800 });
  await page.goto("/app/explorer");

  const rowAction = page.getByRole("button", { name: "Actions for Contacts" });
  await expect(rowAction).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Show Sidebar" }).click();
  const sidebar = page.getByRole("dialog");
  await expect(sidebar).toBeVisible();

  const actionBox = await rowAction.boundingBox();
  const sidebarBox = await sidebar.boundingBox();
  if (!actionBox || !sidebarBox) {
    throw new Error("Expected visible Explorer action and sidebar boxes.");
  }
  // The drawer opens on the leading edge, so it covers the row's own start while
  // the scrim covers the trailing row action. Both shell layers must paint over
  // main content rather than letting its local z-indices show through.
  expect(sidebarBox.x).toBe(0);
  const rowMiddleY = actionBox.y + actionBox.height / 2;
  const underDrawer = { x: sidebarBox.x + sidebarBox.width / 2, y: rowMiddleY };
  const actionCenter = { x: actionBox.x + actionBox.width / 2, y: rowMiddleY };
  expect(actionCenter.x).toBeGreaterThan(sidebarBox.x + sidebarBox.width);
  expect(rowMiddleY).toBeGreaterThan(sidebarBox.y);
  expect(rowMiddleY).toBeLessThan(sidebarBox.y + sidebarBox.height);

  const coverage = await page.evaluate(
    (points) =>
      points.map(({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        if (element?.closest("#routed-pane-sidebar")) {
          return "drawer";
        }
        return element?.closest(".routed-pane-scrim") ? "scrim" : "content";
      }),
    [underDrawer, actionCenter],
  );

  expect(coverage).toEqual(["drawer", "scrim"]);
});

// Growing the hit target is only half of the HIG rule, and it is the half that
// measures clean while still looking wrong: a 44px button around an 18px glyph
// reads as a tiny mark on a phone. The icons carry `size={18}` as an attribute
// and the routed tier re-sizes them in CSS, which is exactly the kind of
// override a refactor drops silently — so assert the drawn box, not the prop.
test("mobile app bar draws its icons at the touch glyph size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 599, height: 800 });
  await page.goto("/app/explorer");

  const sidebarToggle = page.getByRole("button", { name: "Show Sidebar" });
  await expect(sidebarToggle).toBeVisible({ timeout: 30_000 });

  const buttonBox = await sidebarToggle.boundingBox();
  const glyphBox = await sidebarToggle.locator("svg").boundingBox();
  if (!buttonBox || !glyphBox) {
    throw new Error("Expected a visible app bar button and its icon.");
  }

  expect(buttonBox.height).toBeGreaterThanOrEqual(44);
  expect(buttonBox.width).toBeGreaterThanOrEqual(44);
  expect(glyphBox.width).toBeGreaterThanOrEqual(24);
  expect(glyphBox.height).toBeGreaterThanOrEqual(24);
});

// A tab strip is chrome, so on a phone it spans the screen rather than sitting
// inset like content — otherwise its baseline (which reads as the panel's top
// edge) stops short of both sides and the strip floats as a card.
//
// Measuring the bounding box alone is not enough, and that is the whole reason
// this test looks the way it does. The bleed is a negative margin, which escapes
// padding but not a scrollport: where a strip sits inside a scrolling panel, an
// unhandled bleed still *measures* flush to the viewport while being clipped at
// the leading edge and pushed into local horizontal scroll at the trailing one.
// So assert what is painted (`elementsFromPoint` at each edge) and that no
// ancestor scroll container gained horizontal overflow. Cover a strip reached
// through a scrollport (container Get Info) alongside the plain top-level ones.
const TAB_STRIP_SURFACES = [
  { name: "system monitor", path: "/app/system-monitor", tab: "Logs" },
  { name: "blob browser", path: "/app/explorer/blobs", tab: "Blob Browser" },
  { name: "sync lanes", path: "/app/explorer/sync", tab: "Sync Lanes" },
  { name: "backup restore", path: "/app/backup-restore", tab: null },
  // Reached by drilling in rather than by URL, and the one that scrolls inside
  // its own panel — the case a bounding-box-only assertion missed.
  { name: "container info", path: "/app/explorer", tab: "General" },
] as const;

for (const surface of TAB_STRIP_SURFACES) {
  test(`mobile tab strip bleeds to both screen edges (${surface.name})`, async ({
    page,
  }) => {
    const viewportWidth = 599;
    await page.setViewportSize({ width: viewportWidth, height: 800 });
    await page.goto(surface.path);

    if (surface.name === "container info") {
      const rowAction = page.getByRole("button", {
        name: "Actions for Contacts",
      });
      await expect(rowAction).toBeVisible({ timeout: 30_000 });
      await rowAction.click();
      await page.getByText("Get Info", { exact: true }).first().click();
    }

    const strip = page.locator(".mini-app-tabs").first();
    await expect(strip).toBeVisible({ timeout: 30_000 });
    if (surface.tab) {
      await expect(page.getByRole("tab", { name: surface.tab })).toBeVisible();
    }

    const drawn = await strip.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const midY = Math.round(box.top + box.height / 2);
      const paintsAt = (x: number) =>
        document
          .elementsFromPoint(x, midY)
          .some((hit) => hit.closest(".mini-app-tabs") !== null);
      // The strip must fit inside every scroll container between it and the
      // viewport. Deliberately not a scrollWidth check on those ancestors: long
      // unbreakable content (a hash in the System Monitor log) overflows them for
      // reasons that have nothing to do with the strip. Comparing the boxes asks
      // the precise question — did the bleed escape its scrollport?
      const escaped: string[] = [];
      let node: Element | null = element.parentElement;
      while (node) {
        const style = getComputedStyle(node);
        if (style.overflowX !== "visible") {
          const nodeBox = node.getBoundingClientRect();
          const padLeft =
            nodeBox.left + (Number.parseFloat(style.borderLeftWidth) || 0);
          const padRight =
            nodeBox.right - (Number.parseFloat(style.borderRightWidth) || 0);
          if (box.left < padLeft || box.right > padRight) {
            escaped.push(node.className);
          }
        }
        node = node.parentElement;
      }
      return {
        left: box.x,
        width: box.width,
        paintsAtLeftEdge: paintsAt(1),
        paintsAtRightEdge: paintsAt(window.innerWidth - 2),
        escaped,
      };
    });

    expect(drawn.left).toBe(0);
    expect(drawn.width).toBe(viewportWidth);
    expect(drawn.paintsAtLeftEdge).toBe(true);
    expect(drawn.paintsAtRightEdge).toBe(true);
    expect(drawn.escaped).toEqual([]);
  });
}

// One shared popover menu backs every context menu in the app, so this covers
// Contacts, Notes, Org Manager and the rest as much as it covers Explorer. Its
// routed block used to set only the 44px row height, which left the row
// compliant by measure while both the label and the mark inside it read as too
// small: the label never saw the routed type ramp (the global reset gives
// buttons font-family but not font-size, so they sat at the UA default), and the
// icon stayed at its size={16} attribute. Both are CSS overriding values that
// look right in the JSX, so assert what is drawn rather than what is passed.
test("mobile context menu items meet the touch type and glyph size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 599, height: 800 });
  await page.goto("/app/explorer");

  const rowAction = page.getByRole("button", { name: "Actions for Contacts" });
  await expect(rowAction).toBeVisible({ timeout: 30_000 });
  await rowAction.click();

  const item = page
    .locator(".menu button")
    .filter({ has: page.locator("svg") })
    .first();
  await expect(item).toBeVisible();

  const itemBox = await item.boundingBox();
  const glyphBox = await item.locator("svg").first().boundingBox();
  if (!itemBox || !glyphBox) {
    throw new Error("Expected a visible menu item and its icon.");
  }
  const fontSize = await item.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );

  expect(itemBox.height).toBeGreaterThanOrEqual(44);
  expect(fontSize).toBeGreaterThanOrEqual(16);
  expect(glyphBox.width).toBeGreaterThanOrEqual(24);
  expect(glyphBox.height).toBeGreaterThanOrEqual(24);
});

// A key/value info table gives both of its columns a one-character min-content
// (the shared cell rule breaks inside words), so at phone width the auto layout
// hands the space to whichever column wants more of it. On the sync lane detail
// that is the value column — its timestamps are already wide at the touch type
// ramp and a lane error string is wider still — which crushed the label column
// to ~4 characters and stacked "Requested" over three lines. Counting client
// rects over each label's contents is the assertion that catches it: a label
// that fits reports one rect per line, and nothing about the cell's box or its
// text says how many lines the browser actually drew.
test("mobile sync lane detail keeps its labels on one line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/explorer/sync");

  const laneRow = page.locator(".explorer-sync-lane-table-row").first();
  await expect(laneRow).toBeVisible({ timeout: 30_000 });
  await laneRow.locator("button").first().click();
  await page.getByRole("tab", { name: "Timing" }).click();
  await expect(
    page.locator(".explorer-sync-lane-detail th").first(),
  ).toHaveText("Requested");

  // A lane only carries an error once it has actually failed, so stand one in
  // and measure inside the same evaluate: the panel re-renders on sync snapshot
  // changes, not on this write, and layout is up to date within the call.
  const drawn = await page.evaluate(() => {
    const detail = document.querySelector(".explorer-sync-lane-detail");
    const values = Array.from(detail?.querySelectorAll("td") ?? []);
    const lastError = values.at(-1);
    if (lastError) {
      lastError.textContent =
        "Sync failed: HTTP 500 from https://api.example.test/v1/containers/0123456789abcdef/updates after 3 retries";
    }
    const table = detail?.querySelector("table");
    return {
      labels: Array.from(detail?.querySelectorAll("th") ?? []).map((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return { lines: range.getClientRects().length, text: cell.textContent };
      }),
      // Single-line labels must not buy their width with a sideways scroll: the
      // values wrap anywhere, so the table still has to fit the screen.
      tableOverflow: table ? table.scrollWidth - table.clientWidth : null,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

  expect(drawn.labels.length).toBeGreaterThan(0);
  expect(drawn.labels.filter((label) => label.lines !== 1)).toEqual([]);
  expect(drawn.tableOverflow).toBe(0);
  expect(drawn.pageOverflow).toBeLessThanOrEqual(0);
});

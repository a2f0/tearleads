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
// edge) stops short of both sides and the strip floats as a card. The bleed in
// MiniAppTabs.css cancels exactly the `--space-md` that `.mini-app-root` applies,
// which only holds while every tabbed surface sits directly in that root. Assert
// the drawn box on two surfaces that reach the strip by different routes — a
// future strip nested inside extra inline padding would overshoot instead, so
// also assert the page did not gain horizontal overflow.
for (const surface of [
  { path: "/app/system-monitor", tab: "Logs" },
  { path: "/app/explorer/blobs", tab: "Blob Browser" },
]) {
  test(`mobile tab strip bleeds to both screen edges (${surface.path})`, async ({
    page,
  }) => {
    const viewportWidth = 599;
    await page.setViewportSize({ width: viewportWidth, height: 800 });
    await page.goto(surface.path);

    await expect(page.getByRole("tab", { name: surface.tab })).toBeVisible({
      timeout: 30_000,
    });

    const stripBox = await page.locator(".mini-app-tabs").first().boundingBox();
    if (!stripBox) {
      throw new Error(`Expected a visible tab strip on ${surface.path}.`);
    }

    expect(stripBox.x).toBe(0);
    expect(stripBox.width).toBe(viewportWidth);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(viewportWidth);
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

import { expect, test } from "@playwright/test";

/*
 * Routed-tier geometry at the tablet/iPad width, where the shell keeps its
 * persistent rail and the Explorer puts the tree and the item list on screen
 * together. Split from mobile-chrome.spec.ts, which had grown past the repo's
 * file-size budget; that file keeps the phone-width cases and this one takes
 * every test that has to run above the 760px line. Same discipline either side:
 * assert what the browser actually draws — box positions, widths, computed type
 * size — because every value here is set in CSS on top of a JSX attribute that
 * looks right on its own, so a dropped override reads as correct in the source
 * and wrong on the screen.
 */

// Four mini-apps register Refresh through useWindowRefreshMenuItem alone, which
// the windowed shell renders in its View menu. The routed shell has no menu bar
// and its nav rail is a pure app launcher, so the app bar toolbar is the only
// surface left that can carry it. A registration that renders nowhere still
// type-checks and still passes every unit test, so assert the drawn button.
test("routed app bar carries the app's Refresh action", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto("/app/explorer");

  const refresh = page
    .locator(".routed-pane-toolbar")
    .getByRole("button", { name: "Refresh" });
  await expect(refresh).toBeVisible({ timeout: 30_000 });
  await expect(refresh).toBeEnabled({ timeout: 30_000 });

  // Mid-refresh the registration re-labels itself "Refreshing..." and disables
  // the button, so an enabled "Refresh" again is the settled state.
  await refresh.click();
  await expect(refresh).toBeEnabled({ timeout: 30_000 });
});

// Explorer's own rows, which is where the routed tier's enlarged row is most
// visible: a 44px sidebar or list row leading with a 16px mark reads as a bullet
// beside the label rather than as the row's subject. Same hazard as the app
// bar's glyphs in mobile-chrome.spec.ts — the size lives in CSS over a
// `size={16}` attribute — so measure the drawn box, and measure the glyph's
// centre too, since growing it is only right if it stays on the label's centre
// line.
//
// Runs at the tablet/iPad tier rather than on a phone because that is where both
// rows are on screen at once: below 760px the sidebar is a drawer, and the
// narrow item list folds to its two-line summary, whose leading visual is a
// deliberately larger 32px square that these thresholds would not describe.
test("tablet Explorer rows draw centered touch-size glyphs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto("/app/explorer");

  const treeRow = page
    .locator(".explorer-sidebar-row")
    .filter({ has: page.locator(".explorer-folder-icon") })
    .first();
  const itemName = page
    .locator(".explorer-item-name")
    .filter({ has: page.locator(".explorer-item-icon") })
    .first();
  await expect(treeRow).toBeVisible({ timeout: 30_000 });
  await expect(itemName).toBeVisible({ timeout: 30_000 });

  const treeRowBox = await treeRow.boundingBox();
  const treeGlyphBox = await treeRow
    .locator(".explorer-folder-icon")
    .first()
    .boundingBox();
  const itemNameBox = await itemName.boundingBox();
  const itemGlyphBox = await itemName
    .locator(".explorer-item-icon")
    .first()
    .boundingBox();
  if (!treeRowBox || !treeGlyphBox || !itemNameBox || !itemGlyphBox) {
    throw new Error("Expected visible Explorer rows and their icons.");
  }

  expect(treeRowBox.height).toBeGreaterThanOrEqual(44);
  expect(treeGlyphBox.width).toBeGreaterThanOrEqual(24);
  expect(treeGlyphBox.height).toBeGreaterThanOrEqual(24);
  expect(itemGlyphBox.width).toBeGreaterThanOrEqual(24);
  expect(itemGlyphBox.height).toBeGreaterThanOrEqual(24);

  // The tree glyph centres on its whole row; the list glyph centres on the name
  // control it leads, whose row can be taller when a neighbouring cell wraps.
  const centerY = (box: { y: number; height: number }) =>
    box.y + box.height / 2;
  expect(centerY(treeGlyphBox)).toBeCloseTo(centerY(treeRowBox), 0);
  expect(centerY(itemGlyphBox)).toBeCloseTo(centerY(itemNameBox), 0);
});

// The folder you are inside has no row of its own, so its overflow menu hangs
// off the container header — one kebab directly above a column of identical
// ones, placed by two rules that never mention each other: the header spreads
// its children to the panel's edges, the rows are inset by their actions cell's
// padding. They drifted apart by exactly that inset, which reads as a wobble
// rather than a bug. Tablet tier because that is where the 44px touch button
// made the drift the widest and the fix is scoped to it.
test("tablet container header kebab lines up with the row kebabs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto("/app/explorer");

  const headerKebab = page.locator(
    ".explorer-detail .mini-app-header .mini-app-row-actions-button",
  );
  const rowKebab = page
    .locator(".mini-app-row-actions-cell .mini-app-row-actions-button")
    .first();
  await expect(headerKebab).toBeVisible({ timeout: 30_000 });
  await expect(rowKebab).toBeVisible({ timeout: 30_000 });

  const headerBox = await headerKebab.boundingBox();
  const rowBox = await rowKebab.boundingBox();
  if (!headerBox || !rowBox) {
    throw new Error("Expected the header and row kebabs to be laid out.");
  }

  // Same box on the same trailing edge: the two must read as one column.
  expect(headerBox.width).toBeCloseTo(rowBox.width, 0);
  expect(headerBox.x + headerBox.width).toBeCloseTo(rowBox.x + rowBox.width, 0);
});

// A picture that is plainly taller than it is wide, so a viewer that letterboxed
// it against the wrong box would be visible in the numbers below as well.
const PICTURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">
  <rect width="300" height="400" fill="#f5c518"/>
  <rect x="10" y="10" width="280" height="380" fill="none" stroke="#0d6b32" stroke-width="20"/>
</svg>`;

// An image attachment opens in the shared image viewer. On a phone that is the
// whole viewport — the viewer exists so a picture can be pinched and panned
// where nothing else fits — but this tier keeps a rail, an app bar, a tree, and
// a taskbar on screen beside the content, and covering them read as a different
// app having taken over rather than a preview inside this one. It fills the
// content pane here instead, like the note attachment preview beside it.
//
// The fill is pure CSS (`sticky` keyed to the pane) over a portal target, so a
// dropped override would still carry every class and only the browser's layout
// would show it. Assert the drawn boxes.
test("tablet image viewer fills the content pane, not the screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto("/app/notes");
  await page
    .getByRole("button", { name: "New Note", exact: true })
    .click({ timeout: 30_000 });
  await page.getByRole("textbox", { name: "Notes editor" }).waitFor();
  await page.locator(".note-document-file-input").setInputFiles({
    buffer: Buffer.from(PICTURE_SVG),
    mimeType: "image/svg+xml",
    name: "picture.svg",
  });
  await page.getByRole("button", { name: "Open picture.svg" }).click();

  const viewer = page.locator(".mini-app-image-viewer");
  await expect(viewer).toBeVisible({ timeout: 30_000 });

  const paneBox = await page.locator(".routed-pane-main").boundingBox();
  const railBox = await page.locator(".routed-pane-rail").boundingBox();
  const viewerBox = await viewer.boundingBox();
  if (!paneBox || !railBox || !viewerBox) {
    throw new Error("Expected the shell and the image viewer to be laid out.");
  }

  expect(viewerBox.x).toBeCloseTo(paneBox.x, 0);
  expect(viewerBox.y).toBeCloseTo(paneBox.y, 0);
  expect(viewerBox.width).toBeCloseTo(paneBox.width, 0);
  expect(viewerBox.height).toBeCloseTo(paneBox.height, 0);
  // Stated from the other side too: the nav rail is beside the viewer, not under
  // it, and the viewer stops short of the viewport it used to cover.
  expect(viewerBox.x).toBeGreaterThanOrEqual(railBox.x + railBox.width);
  expect(viewerBox.width).toBeLessThan(900);

  // It is still the viewer, and it still closes from inside the pane.
  await expect(viewer.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await viewer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(viewer).toHaveCount(0);
});

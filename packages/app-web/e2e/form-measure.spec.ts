import { expect, type Page, test } from "@playwright/test";

/*
 * Geometry for the form measure (`--form-measure`, packages/ui/src/styles.css).
 * Text-entry columns are capped so an input does not stretch the full width of a
 * maximized window or an iPad; the mobile tier deliberately opts out and stays
 * edge-to-edge. Every one of those is a CSS value layered over markup that looks
 * correct on its own, so assert what the browser draws — a dropped cap and an
 * over-eager one both read as fine in the source.
 *
 * Backup/Restore is the subject because it reaches every tier without auth or
 * seeded data, and it exercises both halves of the rule at once: the fields
 * carry the cap through `.mini-app-field`, and `.backup-restore-main` caps the
 * group so the frame and tab strip track their contents.
 */

interface ColumnGeometry {
  readonly capPx: number | null;
  readonly fieldWidth: number;
  readonly panelWidth: number;
  readonly parentContentWidth: number;
  readonly width: number;
}

async function readColumnGeometry(page: Page): Promise<ColumnGeometry> {
  const column = page.locator(".backup-restore-main");
  await expect(column).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".backup-restore-panel")).toBeVisible();

  return column.evaluate((element) => {
    const parent = element.parentElement;
    if (!parent) {
      throw new Error("backup-restore-main has no parent to measure against.");
    }
    const parentStyle = getComputedStyle(parent);
    const parentContentWidth =
      parent.clientWidth -
      Number.parseFloat(parentStyle.paddingLeft) -
      Number.parseFloat(parentStyle.paddingRight);
    // `max-width: 34rem` resolves to px here; the mobile tier's `100%` does not,
    // which is exactly the distinction the assertions below turn on.
    const rawCap = getComputedStyle(element).maxWidth;
    const capPx = rawCap.endsWith("px") ? Number.parseFloat(rawCap) : null;
    const measure = (selector: string) => {
      const node = element.querySelector(selector);
      return node ? node.getBoundingClientRect().width : 0;
    };

    return {
      capPx,
      fieldWidth: measure(".mini-app-field"),
      panelWidth: measure(".backup-restore-panel"),
      parentContentWidth,
      width: element.getBoundingClientRect().width,
    };
  });
}

// The windowed shell is where the stretch was worst: a maximized window drew the
// password fields as rules spanning the whole desktop. It has to be launched
// from the footer menu — `/app/<id>` deep links belong to the routed shell, and
// the windowed one answers them with an empty desktop. The viewport is taller
// than the other tiers here so that upward-opening menu has room for every
// entry.
test("windowed form column stops at the measure", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto("/");

  const pane = page.locator(".pane:not(.pane-hidden)").first();
  await expect(pane).toBeVisible({ timeout: 30_000 });
  // The footer menu is fixed-positioned against the pane's bottom edge, so it
  // has to be opened against a settled layout: opened while the shell is still
  // mounting, its entries land outside the viewport and never become clickable.
  await expect(pane.locator(".pane-footer")).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => {});
  await pane.getByRole("button", { name: "Menu" }).click();
  await page
    .locator(".menu")
    .getByRole("button", { name: "Backup / Restore", exact: true })
    .click();

  const geometry = await readColumnGeometry(page);

  expect(geometry.capPx).not.toBeNull();
  expect(geometry.width).toBeCloseTo(geometry.capPx ?? 0, 0);
  // The cap has to actually bind here, or this test would pass on a window too
  // narrow to reach it and never notice the cap being dropped.
  expect(geometry.width).toBeLessThan(geometry.parentContentWidth);
  // The frame tracks the column rather than ruling the viewport around it.
  expect(geometry.panelWidth).toBeCloseTo(geometry.width, 0);
  expect(geometry.fieldWidth).toBeLessThanOrEqual(geometry.width);
});

// The tablet/iPad tier: same cap, reached by URL rather than a window.
test("tablet form column stops at the measure", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto("/app/backup-restore");

  const geometry = await readColumnGeometry(page);

  expect(geometry.capPx).not.toBeNull();
  expect(geometry.width).toBeCloseTo(geometry.capPx ?? 0, 0);
  expect(geometry.width).toBeLessThan(geometry.parentContentWidth);
  expect(geometry.panelWidth).toBeCloseTo(geometry.width, 0);
});

// The mobile tier opts out (`--form-measure: 100%` in RoutedPane.css). 599px is
// the case that matters: it is the top of the mobile tier and well past 34rem,
// so a cap that forgot to release here would pull the column in — which is what
// stranded the tab strip's edge-to-edge bleed while this change was being made.
test("mobile form column keeps the full width", async ({ page }) => {
  await page.setViewportSize({ width: 599, height: 800 });
  await page.goto("/app/backup-restore");

  const geometry = await readColumnGeometry(page);

  // `100%` never resolves to px, so a px cap here means the release was lost.
  expect(geometry.capPx).toBeNull();
  expect(geometry.width).toBeCloseTo(geometry.parentContentWidth, 0);
});

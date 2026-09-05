import { expect, type Page, test } from "@playwright/test";
import { measureAttached } from "./domMeasure";

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
  readonly panelWidth: number;
  readonly parentContentWidth: number;
  readonly width: number;
}

async function readColumnGeometry(page: Page): Promise<ColumnGeometry> {
  const column = page.locator(".backup-restore-main");
  await expect(column).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".backup-restore-panel")).toBeVisible();

  return measureAttached("backup-restore column", () =>
    column.evaluate((element) => {
      // A detached node reports every box as zero and every computed style as
      // "", so a stale read here fails exactly like a dropped cap would.
      if (!element.isConnected) {
        return null;
      }

      const parent = element.parentElement;
      if (!parent) {
        throw new Error(
          "backup-restore-main has no parent to measure against.",
        );
      }
      const parentStyle = getComputedStyle(parent);
      const parentContentWidth =
        parent.clientWidth -
        Number.parseFloat(parentStyle.paddingLeft) -
        Number.parseFloat(parentStyle.paddingRight);
      // `max-width: 34rem` resolves to px here; the mobile tier's `100%` does
      // not, which is exactly the distinction the assertions below turn on.
      const rawCap = getComputedStyle(element).maxWidth;
      const capPx = rawCap.endsWith("px") ? Number.parseFloat(rawCap) : null;
      const panel = element.querySelector(".backup-restore-panel");

      return {
        capPx,
        panelWidth: panel ? panel.getBoundingClientRect().width : 0,
        parentContentWidth,
        width: element.getBoundingClientRect().width,
      };
    }),
  );
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
  // Bounded: an app that never goes idle must not eat the whole test timeout
  // before a single assertion runs.
  await page
    .waitForLoadState("networkidle", { timeout: 2_000 })
    .catch(() => {});
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

test("tablet passport image stops at the measure", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto("/app/explorer");

  await page.getByRole("button", { name: "New Document" }).click();
  await page.getByRole("button", { name: "Passport", exact: true }).click();

  const attachmentSlots = page.locator(
    ".structured-document-attachments--single",
  );
  await expect(attachmentSlots).toBeVisible({ timeout: 30_000 });
  const geometry = await measureAttached("passport attachment slots", () =>
    attachmentSlots.evaluate((element) => {
      // Reached by creating a document, so the panel around it is still
      // settling; a detached node reports an empty computed style, which reads
      // as a cap that is not a length.
      if (!element.isConnected) {
        return null;
      }

      const parent = element.parentElement;
      if (!parent) {
        throw new Error("The passport attachment slots have no parent.");
      }
      const rawCap = getComputedStyle(element).maxWidth;

      return {
        capPx: rawCap.endsWith("px") ? Number.parseFloat(rawCap) : null,
        parentWidth: parent.getBoundingClientRect().width,
        width: element.getBoundingClientRect().width,
      };
    }),
  );

  expect(geometry.capPx).not.toBeNull();
  expect(geometry.width).toBeCloseTo(geometry.capPx ?? 0, 0);
  expect(geometry.width).toBeLessThan(geometry.parentWidth);
});

/*
 * The group caps above would hide a regression in the field cap itself: inside
 * a `.backup-restore-main` already held to the measure, a field is narrow even
 * with `.mini-app-field`'s own `max-width` deleted. So measure a field whose
 * parent stays WIDER than the measure — the new-contact form's panel carries no
 * cap of its own, which is the case `.mini-app-field` exists to handle and the
 * one every future form will rely on.
 */
test("a field caps itself inside an uncapped panel", async ({ page }) => {
  // 1000px is still the routed shell (MOBILE_BREAKPOINT_PX is 1024) and leaves
  // the parent comfortably clear of the cap; at 900px the rail and the contacts
  // sidebar eat into it until the margin is thin enough that a chrome tweak
  // would read as a failure of the measure.
  await page.setViewportSize({ width: 1000, height: 1000 });
  await page.goto("/app/contacts/new");

  const field = page.locator(".mini-app-field").first();
  await expect(field).toBeVisible({ timeout: 30_000 });

  const geometry = await measureAttached("contacts field", () =>
    field.evaluate((element) => {
      // An orphaned field has an empty computed style, so its cap reads as "not
      // a length" — the same signal a genuinely missing cap gives.
      if (!element.isConnected) {
        return null;
      }

      const parent = element.parentElement;
      if (!parent) {
        throw new Error("mini-app-field has no parent to measure against.");
      }
      const rawCap = getComputedStyle(element).maxWidth;

      return {
        capPx: rawCap.endsWith("px") ? Number.parseFloat(rawCap) : null,
        parentWidth: parent.getBoundingClientRect().width,
        width: element.getBoundingClientRect().width,
      };
    }),
  );

  expect(geometry.capPx).not.toBeNull();
  // Without this the test would be vacuous, exactly as the group-capped case is.
  expect(geometry.parentWidth).toBeGreaterThan(geometry.capPx ?? 0);
  expect(geometry.width).toBeCloseTo(geometry.capPx ?? 0, 0);
});

// The mobile tier opts out (`--form-measure: 100%` in RoutedPane.css). 759px is
// the case that matters: it is the top of that tier (ROUTED_TABLET_BREAKPOINT_PX
// is 760) and the furthest past 34rem the release ever has to stretch, so a cap
// that forgot to release strands the widest gap here — 215px of column the tab
// strip's edge-to-edge bleed would fall short by.
test("mobile form column keeps the full width", async ({ page }) => {
  await page.setViewportSize({ width: 759, height: 800 });
  await page.goto("/app/backup-restore");

  const geometry = await readColumnGeometry(page);

  // `100%` never resolves to px, so a px cap here means the release was lost.
  expect(geometry.capPx).toBeNull();
  expect(geometry.width).toBeCloseTo(geometry.parentContentWidth, 0);
});

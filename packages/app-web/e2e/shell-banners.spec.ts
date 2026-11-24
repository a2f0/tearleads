import type { Page } from "@playwright/test";
import { expect, test } from "./appTest";
import { switchToWindowedDesktop } from "./windowedDesktop";

/*
 * The runtime restart notice and a billing warning each take a row at the
 * top of the shell (Layout.css), so a user who puts off the reload still sees
 * billing warnings. Neither can be raised on demand here: one needs a Loro
 * runtime trap, the other a lapsed organization. So these tests add each
 * banner's markup to the shell and measure the rows the production CSS
 * gives them.
 */

const SAFE_AREA_TOP = 30;

interface Row {
  readonly bottom: number;
  readonly height: number;
  readonly paddingTop: number;
  readonly top: number;
}

/** Adds a banner with `className` as the shell frame's first child. */
async function addBanner(page: Page, className: string): Promise<void> {
  await page.locator(".tearleads-frame.layout").evaluate((frame, name) => {
    const banner = document.createElement("div");
    banner.className = name;
    banner.textContent = name;
    frame.prepend(banner);
  }, className);
}

/** Measures each selector's box once no finite animation is running. */
async function measureRows(
  page: Page,
  selectors: readonly string[],
): Promise<Row[]> {
  return page.evaluate(async (wanted) => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().endTime !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    );
    return wanted.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const box = element.getBoundingClientRect();
      return {
        bottom: box.bottom,
        height: box.height,
        paddingTop: Number.parseFloat(getComputedStyle(element).paddingTop),
        top: box.top,
      };
    });
  }, selectors);
}

async function expectStackedBanners(page: Page, paneSelector: string) {
  await page.locator("html").evaluate((element, top) => {
    element.style.setProperty("--safe-area-top", `${top}px`);
  }, SAFE_AREA_TOP);

  await addBanner(page, "billing-banner billing-banner--warning");
  const [alone] = await measureRows(page, [".billing-banner"]);
  if (!alone) throw new Error("Expected the billing warning's box.");
  // Alone, the billing warning is the topmost row and owns the inset.
  expect(alone.top).toBe(0);
  expect(alone.height).toBeGreaterThan(0);

  await addBanner(page, "runtime-restart-notice");
  const [notice, billing, pane] = await measureRows(page, [
    ".runtime-restart-notice",
    ".billing-banner",
    paneSelector,
  ]);
  if (!notice || !billing || !pane) {
    throw new Error("Expected the notice, billing warning, and pane boxes.");
  }
  // The notice takes the top row and the inset; the billing warning still
  // shows below it, without the inset, and the panes start below both.
  expect(notice.top).toBe(0);
  expect(notice.height).toBeGreaterThan(0);
  expect(notice.paddingTop).toBeCloseTo(alone.paddingTop, 2);
  expect(billing.height).toBeGreaterThan(0);
  expect(billing.top).toBeCloseTo(notice.bottom, 2);
  expect(billing.paddingTop).toBeCloseTo(alone.paddingTop - SAFE_AREA_TOP, 2);
  expect(pane.top).toBeCloseTo(billing.bottom, 2);
}

test("the restart notice and a billing warning both show in the routed shell", async ({
  page,
}) => {
  await page.setViewportSize({ width: 599, height: 800 });
  await page.goto("/app/explorer");
  await expect(page.locator(".routed-pane")).toBeVisible({ timeout: 30_000 });

  await expectStackedBanners(page, ".routed-pane");
});

test("the restart notice and a billing warning both show on the desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await switchToWindowedDesktop(page);

  await expectStackedBanners(page, ".pane:not(.pane-hidden)");
});

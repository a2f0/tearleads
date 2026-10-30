import { expect, type Page, test } from "@playwright/test";
import { openWindowedDesktop } from "./windowedDesktop";

// The element painted topmost at the middle of an element's box.
function topmostAt(page: Page, selector: string) {
  return page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) {
      throw new Error(`Missing ${target}`);
    }
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return {
      hitsWallpaper: hit?.classList.contains("desktop-wallpaper") ?? false,
      insideTarget: hit ? element.contains(hit) : false,
    };
  }, selector);
}

// The wallpaper is absolutely positioned, while the pinned System Monitor
// lays out in flow; only a real layout shows which one paints on top. Hit
// testing ignores the wallpaper (it takes no pointer input), so also probe
// paint order by letting it take pointer input for the check.
test("the wallpaper paints beneath the pinned System Monitor", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("tearleads.system-monitor:left", "pinned");
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  // Closes the default window, so nothing but the monitor covers the desktop.
  await openWindowedDesktop(page);

  const pane = page.locator(".pane:not(.pane-hidden)").first();
  const wallpaper = pane.locator(".pane-main > .desktop-wallpaper");
  await expect(wallpaper).toHaveAttribute("data-wallpaper", "blocks");
  const status = pane.locator(".pane-main > .pane-content").first();
  await expect(status).toBeVisible();

  await wallpaper.evaluate((element) => {
    if (element instanceof HTMLElement) {
      element.style.pointerEvents = "auto";
    }
  });
  const hit = await topmostAt(
    page,
    ".pane:not(.pane-hidden) .pane-main > .pane-content",
  );
  expect(hit.hitsWallpaper).toBe(false);
  expect(hit.insideTarget).toBe(true);
});

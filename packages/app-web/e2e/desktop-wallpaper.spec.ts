import { expect, type Page, test } from "@playwright/test";
import { wallpaperPixels } from "./wallpaperPixels";
import {
  openWindowedDesktop,
  switchToWindowedDesktop,
} from "./windowedDesktop";

async function openDisplayProperties(page: Page) {
  const pane = page.locator(".pane:not(.pane-hidden)").first();
  await pane
    .locator(".pane-main")
    .click({ button: "right", position: { x: 600, y: 100 } });
  await page
    .getByRole("button", { name: "Display Properties", exact: true })
    .click();
  return pane.getByRole("region", { name: "Display Properties", exact: true });
}

test("designed wallpapers switch, persist, and leave legacy choices reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openWindowedDesktop(page);
  const wallpaper = page
    .locator(".pane:not(.pane-hidden) .desktop-wallpaper")
    .first();
  await expect(wallpaper).toHaveAttribute("data-wallpaper", "tidal");
  const display = await openDisplayProperties(page);
  const choices = [
    ["Facet", "facet"],
    ["Tidal", "tidal"],
    ["Loom", "loom"],
    ["Blocks", "blocks"],
    ["Honeycomb", "honeycomb"],
    ["Triangles", "triangles"],
    ["None", "plain"],
  ];
  for (const [label = "", id = ""] of choices) {
    const card = display
      .locator("label")
      .filter({ has: page.getByRole("radio", { name: label, exact: true }) });
    await card.click();
    await expect(card).toBeInViewport();
    await expect(
      display.getByRole("radio", { name: label, exact: true }),
    ).toBeChecked();
    await expect(wallpaper).toHaveAttribute("data-wallpaper", id);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("tearleads.wallpaper.choice"),
      ),
    ).toBe(id);
  }
  // None is an explicit saved choice, not an instruction to adopt a new default.
  await page.reload();
  await switchToWindowedDesktop(page);
  await expect(wallpaper).toHaveAttribute("data-wallpaper", "plain");
  await expect(wallpaper).not.toHaveAttribute("data-pattern");
});

for (const [label, id] of [
  ["Tidal", "tidal"],
  ["Facet", "facet"],
  ["Loom", "loom"],
]) {
  test(`${label} tiles continuously and follows every theme without losing the saved choice`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openWindowedDesktop(page);
    const display = await openDisplayProperties(page);
    const wallpaper = page
      .locator(".pane:not(.pane-hidden) .desktop-wallpaper")
      .first();
    await display.getByText(label ?? "", { exact: true }).click();
    const colors = new Set<string>();
    for (const theme of ["Light", "Dark", "Dusk"]) {
      await display.getByText(theme, { exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        theme.toLowerCase(),
      );
      const pixels = await wallpaperPixels(wallpaper);
      expect(pixels.horizontalSeam).toBeLessThan(3);
      expect(pixels.verticalSeam).toBeLessThan(3);
      expect(pixels.maximumAlpha - pixels.minimumAlpha).toBeGreaterThan(0.15);
      expect(pixels.minimumContrast).toBeGreaterThanOrEqual(4.5);
      if (theme === "Light") {
        expect(pixels.baseLuminance).toBeGreaterThan(0.7);
      } else {
        expect(pixels.baseLuminance).toBeLessThan(0.08);
      }
      colors.add(pixels.base);
      await expect(wallpaper).toHaveAttribute("data-wallpaper", id ?? "");
    }
    expect(colors.size).toBe(3);
    await page.reload();
    await switchToWindowedDesktop(page);
    await expect(wallpaper).toHaveAttribute("data-wallpaper", id ?? "");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dusk");
  });
}

for (const id of ["blocks", "honeycomb", "triangles", "plain"]) {
  test(`an existing ${id} preference is not replaced by the new default`, async ({
    page,
  }) => {
    await page.addInitScript((saved) => {
      localStorage.setItem("tearleads.wallpaper.choice", saved);
    }, id);
    await page.setViewportSize({ width: 1400, height: 900 });
    await openWindowedDesktop(page);
    await expect(
      page.locator(".pane:not(.pane-hidden) .desktop-wallpaper").first(),
    ).toHaveAttribute("data-wallpaper", id);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("tearleads.wallpaper.choice"),
      ),
    ).toBe(id);
  });
}

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
  await expect(wallpaper).toHaveAttribute("data-wallpaper", "tidal");
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

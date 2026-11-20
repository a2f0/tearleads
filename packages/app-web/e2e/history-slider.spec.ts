import { expect, test } from "@playwright/test";
import { controlPixels } from "./controlPixels";
import { themeForeground } from "./themeForeground";

test.use({ hasTouch: true });

test("History slider paints and seeks across browser engines", {
  tag: "@themed-control",
}, async ({ browserName, page }) => {
  // Load the production CSS independently of a browser's local database support.
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", /.+/);
  const control = page.locator("#test-history-slider");
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "range";
    input.className = "explorer-document-history-slider";
    input.id = "test-history-slider";
    input.min = "0";
    input.max = "4";
    input.value = "4";
    input.style.cssText =
      "position: fixed; top: 0; left: 0; z-index: 2147483647; width: 200px";
    document.body.append(input);
  });
  const reference = page.locator("#test-history-track");
  await control.evaluate((element) => {
    const swatch = document.createElement("div");
    swatch.id = "test-history-track";
    swatch.style.cssText =
      "position:fixed;left:0;top:50px;width:16px;height:16px;z-index:2147483647;background:color-mix(in oklab,var(--color-dark),var(--color-light))";
    element.after(swatch);
  });
  const accents = new Set<string>();
  for (const theme of ["light", "dark", "dusk"]) {
    await page.evaluate((id) => {
      document.documentElement.setAttribute("data-theme", id);
    }, theme);
    const accent = await themeForeground(control);
    await expect(control).toHaveCSS("accent-color", accent);
    if (theme !== "dusk") {
      expect(accent).toMatch(/^rgb\((\d+), \1, \1\)$/);
    }
    const pixels = await controlPixels(control);
    const thumb = pixels.row.at(-8);
    const track = pixels.row[Math.floor(pixels.row.length / 2)];
    expect(thumb).toBe(accent);
    expect(track).toBe((await controlPixels(reference)).row[8]);
    expect(track).not.toBe(pixels.background);
    expect(track).not.toBe(thumb);
    accents.add(accent);
  }
  expect(accents.size).toBe(3);
  await control.tap({ position: { x: 1, y: 12 } });
  await expect(control).toHaveValue("0");
  await page.emulateMedia({ forcedColors: "active" });
  const forcedColorsActive = await page.evaluate(
    () => matchMedia("(forced-colors: active)").matches,
  );
  if (browserName !== "webkit") expect(forcedColorsActive).toBe(true);
  if (forcedColorsActive) {
    await expect(control).toHaveCSS("appearance", "auto");
    const forced = await controlPixels(control);
    // Compare with a native range at the same position and size, on the same host.
    await control.evaluate((element) => {
      const height = element.getBoundingClientRect().height;
      element.classList.remove("explorer-document-history-slider");
      element.style.height = `${height}px`;
      element.style.appearance = "auto";
    });
    expect(forced).toEqual(await controlPixels(control));
  }
});

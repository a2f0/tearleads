import { expect, test } from "@playwright/test";
import { controlPixels } from "./controlPixels";
import { themeForeground } from "./themeForeground";

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

test("History slider paints and seeks across browser engines", {
  tag: "@themed-control",
}, async ({ browserName, page }) => {
  // Load the production CSS independently of a browser's local database support.
  await page.goto("/app/explorer");
  await expect(page.locator("html")).toHaveAttribute(
    "data-navigation-mode",
    "routed",
  );
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
  expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await control.tap({ position: { x: 2, y: 4 } });
  await expect(control).toHaveValue("0");
  const bounds = await control.boundingBox();
  if (!bounds) throw new Error("History slider has no touch target");
  const midX = bounds.x + bounds.width / 2;
  const midY = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 8, midY);
  await page.mouse.down();
  await page.mouse.move(midX, midY, { steps: 5 });
  await page.mouse.up();
  await expect(control).toHaveValue("2");
  const middle = await controlPixels(control);
  expect(middle.row[Math.floor(middle.row.length / 2)]).toBe(
    await themeForeground(control),
  );
  expect(middle.row.at(-8)).toBe((await controlPixels(reference)).row[8]);
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

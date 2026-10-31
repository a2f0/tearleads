import { expect, type Page, test } from "@playwright/test";
import { openWindowedDesktop } from "./windowedDesktop";

async function openDisplayProperties(page: Page) {
  await openWindowedDesktop(page);
  const pane = page.locator(".pane:not(.pane-hidden)").first();
  await pane
    .locator(".pane-main")
    .click({ button: "right", position: { x: 200, y: 100 } });
  await page
    .getByRole("button", { name: "Display Properties", exact: true })
    .click();
  return pane.getByRole("region", { name: "Display Properties", exact: true });
}

test("previews fit full tile height without changing desktop tile sizes", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const display = await openDisplayProperties(page);
  // A host may import the generic wallpaper rule after Display Properties.
  await page.addStyleTag({
    content: `.wallpaper-pattern[data-pattern]::before {
      -webkit-mask-size: var(--wallpaper-size);
      mask-size: var(--wallpaper-size);
    }`,
  });
  const desktop = page
    .locator(".pane:not(.pane-hidden) .desktop-wallpaper")
    .first();
  for (const label of [
    "Tidal",
    "Facet",
    "Loom",
    "Blocks",
    "Honeycomb",
    "Triangles",
  ]) {
    const card = display.locator("label").filter({
      has: page.getByRole("radio", { name: label, exact: true }),
    });
    await card.click();
    const swatch = card.locator(".display-properties-swatch");
    const mask = await swatch.evaluate((element) => {
      const style = getComputedStyle(element, "::before");
      return {
        size: style.maskSize,
        repeat: style.maskRepeat,
        nativeSize:
          getComputedStyle(element).getPropertyValue("--wallpaper-size"),
      };
    });
    expect(mask.size).toBe("auto 100%");
    expect(mask.repeat).toBe("repeat");
    expect(
      await desktop.evaluate(
        (element) => getComputedStyle(element, "::before").maskSize,
      ),
    ).toBe(mask.nativeSize.trim());
    // Inspect actual painting too: an empty/transparent preview can have the
    // right computed size while still showing no artwork.
    const painted = await swatch.screenshot();
    const hideInk = await page.addStyleTag({
      content: ".display-properties-swatch::before { visibility: hidden; }",
    });
    const blank = await swatch.screenshot();
    await hideInk.evaluate((element) =>
      element.parentNode?.removeChild(element),
    );
    expect(painted.equals(blank)).toBe(false);
  }
  for (const theme of ["Light", "Dark", "Dusk"]) {
    await display.getByText(theme, { exact: true }).click();
    await testInfo.attach(`display-properties-${theme.toLowerCase()}`, {
      body: await display.screenshot({
        path: testInfo.outputPath(
          `display-properties-${theme.toLowerCase()}.png`,
        ),
      }),
      contentType: "image/png",
    });
  }
});

test("the initial window fits every wallpaper and theme without scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const display = await openDisplayProperties(page);
  await expect(display).toHaveCSS("width", "500px");
  await expect(display).toHaveCSS("height", "340px");
  const scroller = display.locator(".window-body-content-scroll");
  const sizes = await scroller.evaluate((element) => ({
    height: element.clientHeight,
    content: element.scrollHeight,
    top: element.scrollTop,
  }));
  expect(sizes.top).toBe(0);
  expect(sizes.content).toBeLessThanOrEqual(sizes.height);
  await expect(display.locator(".display-properties-wallpaper")).toHaveCount(7);
  await expect(display.locator(".display-properties-theme")).toHaveCount(3);
  for (const card of await display.locator("label").all()) {
    await expect(card).toBeInViewport({ ratio: 1 });
  }
});

test("a narrow desktop keeps all display controls reachable by scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 360 });
  const display = await openDisplayProperties(page);
  for (const label of ["Loom", "None", "Dark", "Dusk", "Light"]) {
    const card = display.locator("label").filter({
      has: page.getByRole("radio", { name: label, exact: true }),
    });
    await card.click();
    await expect(card).toBeInViewport({ ratio: 1 });
    await expect(card.getByRole("radio")).toBeChecked();
  }
  expect(
    await display
      .locator(".window-body-content-scroll")
      .evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
});

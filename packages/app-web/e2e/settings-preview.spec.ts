import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./appTest";
import { controlPixels } from "./controlPixels";
import { themeForeground } from "./themeForeground";
import { openWindowedDesktop } from "./windowedDesktop";

async function openSettingsFromTray(page: Page) {
  await openWindowedDesktop(page);
  const pane = page.locator(".pane:not(.pane-hidden)").first();
  await pane
    .getByRole("list", { name: "System tray" })
    .getByRole("button", { name: /Switch to .* theme/ })
    .click({ button: "right" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = pane.getByRole("region", { name: "Settings", exact: true });
  await expect(
    settings.getByRole("tab", { name: "System tray" }),
  ).toHaveAttribute("aria-selected", "true");
  return settings;
}

test("previews fit full tile height without changing desktop tile sizes", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const display = await openSettingsFromTray(page);
  await display.getByRole("tab", { name: "Desktop" }).click();
  // A host may import the generic wallpaper rule after Settings.
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
    await testInfo.attach(`settings-${theme.toLowerCase()}`, {
      body: await display.screenshot({
        path: testInfo.outputPath(`settings-${theme.toLowerCase()}.png`),
      }),
      contentType: "image/png",
    });
  }
});

async function expectControlsToFit(display: Locator) {
  const scroller = display.locator(".window-body-content-scroll");
  const sizes = await scroller.evaluate((element) => ({
    height: element.clientHeight,
    content: element.scrollHeight,
    top: element.scrollTop,
  }));
  expect(sizes.top).toBe(0);
  expect(sizes.content).toBeLessThanOrEqual(sizes.height);
  for (const card of await display.locator("label").all()) {
    await expect(card).toBeInViewport({ ratio: 1 });
  }
}

test("the initial window fits every wallpaper, theme, and tray switch without scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const display = await openSettingsFromTray(page);
  await display.getByRole("tab", { name: "Desktop" }).click();
  await expect(display).toHaveCSS("width", "500px");
  await expect(display).toHaveCSS("height", "670px");
  await expectControlsToFit(display);
  await expect(display.locator(".display-properties-wallpaper")).toHaveCount(7);
  await expect(display.locator(".display-properties-theme")).toHaveCount(3);
  await display.getByRole("tab", { name: "System tray" }).click();
  await expectControlsToFit(display);
  const tray = display.getByRole("group", { name: "System Tray" });
  await expect(tray.getByRole("switch")).toHaveCount(4);
  await expect(
    tray.getByRole("switch", { name: "Network Control" }),
  ).not.toBeChecked();
  await expect(
    display.getByRole("switch", { name: /screensaver/i }),
  ).toHaveCount(0);
  await display.getByRole("tab", { name: "Start menu" }).click();
  await expectControlsToFit(display);
  const menu = display.getByRole("group", { name: "Start menu" });
  await expect(
    menu.getByRole("switch", { name: "Contacts" }),
  ).not.toBeChecked();
  await expect(menu.getByRole("switch", { name: "Notes" })).not.toBeChecked();
  for (const label of await menu.locator(".display-properties-label").all()) {
    expect(
      await label.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
  }
  await expect(
    display.getByRole("switch", { name: /screensaver/i }),
  ).toHaveCount(0);
});

test("a narrow desktop keeps all display controls reachable by scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 360 });
  const display = await openSettingsFromTray(page);
  await display.getByRole("tab", { name: "Desktop" }).click();
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

test("Settings restores a hidden Start menu entry across a reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const settings = await openSettingsFromTray(page);
  const pane = page.locator(".pane:not(.pane-hidden)").first();
  const start = pane.getByRole("button", { name: "Menu", exact: true });
  const menu = page.locator(".menu");
  await start.click();
  // Explorer is offered once the session is ready to launch apps.
  await expect(
    menu.getByRole("button", { name: "Explorer", exact: true }),
  ).toBeVisible();
  await expect(
    menu.getByRole("button", { name: "Notes", exact: true }),
  ).toHaveCount(0);
  await expect(
    menu.getByRole("button", { name: "Contacts", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await start.click({ button: "right" });
  await page.getByRole("button", { name: "Start menu settings" }).click();
  await expect(
    settings.getByRole("tab", { name: "Start menu" }),
  ).toHaveAttribute("aria-selected", "true");
  await settings.getByRole("switch", { name: "Notes", exact: true }).check();
  await page.reload();
  await start.click();
  await menu.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(
    pane.getByRole("region", { name: "Notes", exact: true }),
  ).toBeVisible();
});

test("a second tab can hide the focused phone launcher entry", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/explorer");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const launcher = page.getByRole("navigation", { name: "Apps" });
  const explorer = launcher.getByRole("link", { name: "Explorer" });
  await explorer.focus();
  await expect(explorer).toBeFocused();

  const settings = await context.newPage();
  await settings.goto("/app/explorer");
  await settings
    .getByRole("button", { name: "Menu", exact: true })
    .click({ button: "right" });
  await settings.getByRole("button", { name: "Start menu settings" }).click();
  await expect(settings).toHaveURL(/\/app\/display-properties\/start-menu$/);
  await settings
    .getByRole("switch", { name: "Explorer", exact: true })
    .uncheck();
  await expect(explorer).toHaveCount(0);
  await expect(launcher.getByRole("link").first()).toBeFocused();
});

test.describe("touch Start button", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("holding Start opens its settings menu and releasing keeps the launcher closed", async ({
    page,
    context,
  }) => {
    await page.goto("/app/explorer");
    const start = page.getByRole("button", { name: "Menu", exact: true });
    await expect(start).toBeVisible();
    const bounds = await start.boundingBox();
    if (!bounds) throw new Error("Missing Start button bounds");
    const session = await context.newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      ],
    });
    const settings = page.getByRole("button", { name: "Start menu settings" });
    await expect(settings).toBeVisible();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(start).toHaveAttribute("aria-expanded", "false");
    await settings.tap();
    await expect(
      page.getByRole("tab", { name: "Start menu", selected: true }),
    ).toBeVisible();
  });
});

test("Network settings and the tray control the same network mode", async ({
  page,
}) => {
  const settings = await openSettingsFromTray(page);
  const networkTab = settings.getByRole("tab", {
    name: "Network",
    exact: true,
  });
  await networkTab.click();
  const radio = (name: string) => settings.getByRole("radio", { name });
  await expect(settings.getByRole("radio")).toHaveCount(3);
  await expect(radio("Use Automatic Network")).toBeChecked();
  await radio("Force Offline").check();

  await settings.getByRole("tab", { name: "System tray" }).click();
  await settings.getByRole("switch", { name: "Network Control" }).check();
  await networkTab.click();
  await expect(radio("Force Offline")).toBeChecked();
  await page
    .getByRole("button", { name: "Network Control: offline (manual)" })
    .click();
  await page.getByRole("button", { name: "Force Online", exact: true }).click();
  await expect(radio("Force Online")).toBeChecked();
  await radio("Use Automatic Network").check();
  await expect(
    page.getByRole("button", { name: /^Network Control: .* \(automatic\)$/ }),
  ).toBeVisible();
});

test("Network radio labels meet the phone touch target", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/display-properties/network");
  const group = page.getByRole("group", { name: "Network control" });
  await expect(group.getByRole("radio")).toHaveCount(3);
  for (const label of await group.locator("label").all()) {
    await expect(label).toBeVisible();
    expect((await label.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
});

test("Network radios use the active theme for selection and keyboard focus", {
  tag: "@themed-control",
}, async ({ browserName, page }) => {
  const settings = await openSettingsFromTray(page);
  const painted = new Set<string>();
  for (const theme of ["Light", "Dark", "Dusk"]) {
    await settings.getByRole("tab", { name: "Desktop" }).click();
    await settings.getByText(theme, { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      theme.toLowerCase(),
    );
    await settings.getByRole("tab", { name: "Network" }).click();
    const radio = settings.getByRole("radio", {
      name: "Use Automatic Network",
    });
    await expect(radio).toBeChecked();
    await expect(radio).toBeVisible();
    await expect(radio).toHaveCSS("appearance", "auto");
    const tab = settings.getByRole("tab", { name: "Network" });
    await tab.focus();
    // Option-Tab includes all form controls in macOS Safari.
    await page.keyboard.press(
      browserName === "webkit" && process.platform === "darwin"
        ? "Alt+Tab"
        : "Tab",
    );
    await expect(radio).toBeFocused();
    const foreground = await themeForeground(radio);
    if (theme !== "Dusk") {
      expect(foreground).toMatch(/^rgb\((\d+), \1, \1\)$/);
    }
    const { row } = await controlPixels(radio);
    const expected = foreground.match(/\d+/g)?.map(Number) ?? [];
    // Native antialiasing can round the three painted channels slightly.
    const indicator = row.find((color) => {
      const channels = color.match(/\d+/g)?.map(Number) ?? [];
      return (
        expected.length === 3 &&
        expected.every(
          (value, i) => Math.abs(value - (channels[i] ?? Infinity)) <= 1,
        )
      );
    });
    expect(indicator).toBeDefined();
    if (indicator) painted.add(indicator);
    await expect(radio).toHaveCSS("accent-color", foreground);
    await expect(radio).toHaveCSS("outline-color", foreground);
    await expect(radio).toHaveCSS("outline-style", "solid");
    await expect(radio).toHaveCSS("outline-width", "2px");
  }
  expect(painted.size).toBe(3);
});

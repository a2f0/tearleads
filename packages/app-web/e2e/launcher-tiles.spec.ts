import { expect, test } from "@playwright/test";

for (const { name, width, height, moveToBottom } of [
  { name: "narrow phone", width: 320, height: 700, moveToBottom: false },
  { name: "phone", width: 360, height: 800, moveToBottom: false },
  { name: "desktop", width: 1440, height: 900, moveToBottom: true },
]) {
  test(`${name} bottom launcher icons scale with their tiles`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/app/explorer");

    if (moveToBottom) {
      await page
        .locator(".routed-pane-rail")
        .getByRole("button", { name: "Move launcher to bottom" })
        .click();
    }
    await page.getByRole("button", { name: "Menu", exact: true }).click();

    const tile = page.locator(".routed-pane-sheet-tile").first();
    await expect(tile).toBeVisible({ timeout: 30_000 });
    const tileBox = await tile.boundingBox();
    const iconBox = await tile.locator("svg").boundingBox();
    if (!tileBox || !iconBox) {
      throw new Error("Expected a launcher tile and icon.");
    }

    expect(iconBox.width).toBeGreaterThanOrEqual(48);
    expect(iconBox.width).toBeLessThanOrEqual(80);
    expect(iconBox.width / tileBox.width).toBeGreaterThanOrEqual(0.28);
    expect(iconBox.width / tileBox.width).toBeLessThanOrEqual(0.45);
    expect(iconBox.height).toBeCloseTo(iconBox.width, 0);
  });
}

test("moving an open tablet launcher keeps it open", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/explorer");

  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await menu.click();
  const rail = page.locator(".routed-pane-rail");
  await expect(rail).toHaveAttribute("data-state", "open");
  await rail.getByRole("button", { name: "Move launcher to bottom" }).click();

  const sheet = page.locator(".routed-pane-sheet");
  await expect(sheet).toHaveAttribute("data-open", "true");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await sheet.getByRole("button", { name: "Move launcher to side" }).click();
  await expect(rail).toHaveAttribute("data-state", "open");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
});

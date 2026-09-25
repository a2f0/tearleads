import { expect, test } from "@playwright/test";

for (const { name, width, height, moveToBottom } of [
  { name: "narrow phone", width: 320, height: 700, moveToBottom: false },
  { name: "phone", width: 360, height: 800, moveToBottom: false },
  { name: "wide phone", width: 600, height: 800, moveToBottom: false },
  { name: "desktop", width: 1440, height: 900, moveToBottom: true },
  { name: "wide desktop", width: 2560, height: 1200, moveToBottom: true },
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

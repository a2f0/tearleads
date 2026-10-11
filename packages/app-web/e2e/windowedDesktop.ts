import { expect, type Page } from "@playwright/test";

export async function switchToWindowedDesktop(page: Page): Promise<void> {
  await page
    .locator(".pane:not(.pane-hidden), .routed-pane")
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
  const pane = page.locator(".pane:not(.pane-hidden)").first();
  if (!(await pane.isVisible())) {
    await page
      .getByRole("button", { name: "Switch to windowed layout", exact: true })
      .click();
  }
  await expect(pane).toBeVisible({
    timeout: 30_000,
  });
  await expect(pane.locator(".pane-footer")).toBeVisible();
}

export async function openWindowedDesktop(page: Page): Promise<void> {
  await page.goto("/");
  await switchToWindowedDesktop(page);
  // These tests open their own windows, starting from an empty desktop.
  const pane = page.locator(".pane:not(.pane-hidden)").first();
  const explorer = pane.getByRole("region", { name: "Explorer", exact: true });
  await expect(explorer).toBeVisible();
  await explorer.getByRole("button", { name: "Close window" }).click();
  await expect(pane.locator(".window")).toHaveCount(0);
}

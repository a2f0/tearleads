import { expect, type Page } from "@playwright/test";

export async function switchToWindowedDesktop(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Switch to windowed layout", exact: true })
    .click();
  const pane = page.locator(".pane:not(.pane-hidden)").first();
  await expect(pane).toBeVisible({
    timeout: 30_000,
  });
  await expect(pane.locator(".pane-footer")).toBeVisible();
  await page
    .waitForLoadState("networkidle", { timeout: 2_000 })
    .catch(() => {});
}

export async function openWindowedDesktop(page: Page): Promise<void> {
  await page.goto("/");
  await switchToWindowedDesktop(page);
}

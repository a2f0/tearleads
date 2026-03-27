import { expect, test } from "@playwright/test";

test("page loads", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("App");
  await expect(
    page.locator(".pane-content", { hasText: "sqlite worker: ready" }).first(),
  ).toBeVisible();
});

import { expect, test } from "@playwright/test";

test("page loads", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("App");
  await expect(page.getByText(/worker: ready/).first()).toBeVisible();
});

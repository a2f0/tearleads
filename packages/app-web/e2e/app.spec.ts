import { expect, test } from "@playwright/test";

test("page loads", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("App");
  const firstVisiblePane = page.locator(".pane:not(.pane-hidden)").first();
  await expect(
    firstVisiblePane.getByText(
      "Generate a key pair from the pane menu to boot this pane.",
    ),
  ).toBeVisible();
  await firstVisiblePane.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Generate Key Pair" }).click();

  await expect(
    page.locator(".pane-content", { hasText: "sqlite worker: ready" }).first(),
  ).toBeVisible();
});

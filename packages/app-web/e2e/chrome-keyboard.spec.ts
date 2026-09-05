import { expect, test } from "@playwright/test";

test("desktop launcher supports keyboard selection, dismissal and taskbar state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const launcher = page
    .locator(".pane:not(.pane-hidden) .pane-footer-menu-button")
    .first();
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  await launcher.focus();
  await page.keyboard.press("Enter");
  const explorer = page
    .locator(".menu")
    .getByRole("button", { name: "Explorer", exact: true });
  await expect(explorer).toBeVisible();
  const menuBox = await page.locator(".menu").boundingBox();
  const triggerBox = await launcher.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();
  expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(
    triggerBox?.y ?? 0,
  );
  await page.keyboard.press("End");
  await expect(
    page.locator(".menu button:not(:disabled)").last(),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".menu")).toHaveCount(0);
  await expect(launcher).toBeFocused();

  await page.keyboard.press("Enter");
  await explorer.focus();
  await page.keyboard.press("Enter");
  const window = page.locator(".window").first();
  await expect(window).toBeVisible();
  const task = page.getByRole("button", { name: "Activate Explorer window" });
  await expect(task).toHaveAttribute("aria-pressed", "true");
  await window
    .getByRole("button", { name: "Minimize window", exact: true })
    .click();
  await expect(task).toHaveAttribute("aria-pressed", "false");
  await task.click();
  await expect(window).toBeVisible();
  await expect(task).toHaveAttribute("aria-pressed", "true");
});

test("Tab leaves a popover through its trigger without cycling through a closed portal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const launcher = page
    .locator(".pane:not(.pane-hidden) .pane-footer-menu-button")
    .first();
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  await launcher.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".menu")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(".menu")).toHaveCount(0);
  const next = page
    .locator(".pane:not(.pane-hidden) .pane-footer-end button")
    .first();
  await expect(next).toBeFocused();
});

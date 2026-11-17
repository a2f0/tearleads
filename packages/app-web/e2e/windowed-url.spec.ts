import { expect, test } from "./appTest";
import { switchToWindowedDesktop } from "./windowedDesktop";

// The URL names the app in both layouts. Switching from the tablet shell on an
// app's route used to leave that app behind and show only the default
// Explorer window; the reverse switch already showed the URL's app.
test("switching to windows opens the URL's app", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/system-monitor");
  await expect(page.locator(".routed-pane--tablet")).toBeVisible();

  await switchToWindowedDesktop(page);

  const pane = page.locator(".pane:not(.pane-hidden)").first();
  const monitor = pane.getByRole("region", {
    name: "System Monitor",
    exact: true,
  });
  await expect(monitor).toBeVisible();
  await expect(monitor.getByRole("tab", { name: "Logs" })).toBeVisible();
  await expect(pane.locator(".window")).toHaveCount(2);
  await expect(page).toHaveURL(/\/app\/system-monitor$/u);

  // The saved windowed choice honors the same URL on a fresh load.
  await page.reload();
  await expect(monitor).toBeVisible();
  await expect(pane.locator(".window")).toHaveCount(2);
});

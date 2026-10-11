import { expect, test } from "@playwright/test";
import {
  openWindowedApp,
  preferWindowedScreenshotLayout,
  visiblePane,
  waitForBooted,
} from "../screenshots/appShell";

test("screenshot bootstrap leaves the explicitly opened app first", async ({
  page,
}) => {
  test.setTimeout(60_000);
  preferWindowedScreenshotLayout(page);
  await page.goto("/");
  await waitForBooted(page);
  await openWindowedApp(page, "Notes");
  await expect(
    visiblePane(page)
      .locator(".window")
      .first()
      .locator(".window-titlebar-title"),
  ).toHaveText("Notes");
  await expect(visiblePane(page).locator(".window")).toHaveCount(1);
  await page.reload();
  await waitForBooted(page);
  await expect(visiblePane(page).locator(".window")).toHaveCount(0);
});

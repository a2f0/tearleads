import { expect, test } from "@playwright/test";
import { createFirstIdentity } from "./createFirstIdentity";

/*
 * Before a device has an identity there is no local database, so the Sync
 * Status tray has no queue to read. It used to wait for that first read and
 * show "Checking sync status…" and "Downloads: checking…" for as long as the
 * onboarding screen stayed up; it should say why nothing syncs instead, and
 * hand over to the real status once an identity exists.
 */

const NO_IDENTITY_TITLE = "Not syncing — this device has no identity yet";

test("the sync tray says nothing syncs until the device has an identity", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page
      .getByRole("button", { name: "Create new identity", exact: true })
      .first(),
  ).toBeVisible({ timeout: 30_000 });

  const indicator = page.getByRole("button", { name: NO_IDENTITY_TITLE });
  await expect(indicator).toBeVisible({ timeout: 30_000 });
  await indicator.click();
  const details = page.locator(".sync-status-popover-details");
  await expect(details).toHaveText(
    "Create or restore an identity to start syncing.",
  );
  await expect(page.getByText("Downloads: checking…")).toHaveCount(0);
  await expect(page.locator(".sync-status-popover-action")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);

  await createFirstIdentity(page);
  // Once the identity's database opens, the tray reads its queue as usual.
  const tray = page.locator(".sync-status-indicator").first();
  await expect
    .poll(() => tray.getAttribute("title"), { timeout: 30_000 })
    .not.toMatch(/^(Not syncing|Checking sync status)/u);
});

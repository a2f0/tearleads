import type { Page, Route } from "@playwright/test";
import { expect, test } from "./appTest";
import { SIGNED_IN_APP_URL } from "./signedInServer";

test.use({ baseURL: SIGNED_IN_APP_URL, viewport: { width: 390, height: 844 } });

/** Hold the real sync request so assertions are independent of API latency. */
async function withDocumentSyncHeld(page: Page, run: () => Promise<void>) {
  const pattern = /\/documents\/[^/]+\/sync$/u;
  const release = Promise.withResolvers<void>();
  const hold = async (route: Route) => {
    await release.promise;
    await route.continue();
  };
  await page.route(pattern, hold);
  try {
    await run();
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
}

test("an organization rename covers the profile and keeps its tabs available", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/app/org-manager/organization");
  const field = page.getByLabel("Organization name", { exact: true });
  await expect(field).toBeEditable({ timeout: 60_000 });
  const profile = page.getByRole("tab", { name: "Profile", exact: true });
  const cover = page
    .getByRole("status")
    .filter({ hasText: "Syncing organization profile" });
  await field.fill("Updated organization");
  await withDocumentSyncHeld(page, async () => {
    await field.press("Enter");
    await expect(cover).toBeVisible();
    await expect(field).toBeHidden();
    await page.getByRole("tab", { name: "Policy history" }).click();
    await expect(cover).toBeHidden();
    await profile.click();
    await expect(cover).toBeVisible();
  });
  await expect(field).toBeVisible();
  await expect(field).toHaveValue("Updated organization");
});

test("roster name sync preserves a focused draft and hides covered controls from keyboard focus", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/app/org-manager/directory");
  const self = page.getByRole("row", { name: /Actions for Bob/u });
  await expect(self).toBeVisible({ timeout: 60_000 });
  await self.click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const first = page.getByLabel("First name", { exact: true });
  const last = page.getByLabel("Last name", { exact: true });
  const copy = page.getByLabel("Copy user ID", { exact: true });
  const cover = page.locator(".org-manager-profile-cover");
  await expect(copy).toBeVisible();
  await first.fill("Updated first");
  await withDocumentSyncHeld(page, async () => {
    await first.press("Tab");
    await expect(last).toBeFocused();
    await expect(cover).toBeAttached();
    await expect(cover).toBeHidden();
    await last.fill("Last name draft");
  });
  await expect(cover).toHaveCount(0);
  await expect(last).toBeFocused();
  await expect(last).toHaveValue("Last name draft");

  await withDocumentSyncHeld(page, async () => {
    await last.press("Enter");
    await expect(cover).toBeVisible();
    await expect(copy).toBeHidden();
    await copy.focus();
    await expect(copy).not.toBeFocused();
  });
  await expect(copy).toBeVisible();
  await expect(last).toHaveValue("Last name draft");
});

import type { Page, Route } from "@playwright/test";
import { expect, test } from "./appTest";
import { SIGNED_IN_API_URL, SIGNED_IN_APP_URL } from "./signedInServer";

test.use({ baseURL: SIGNED_IN_APP_URL, viewport: { width: 390, height: 844 } });

async function openProfile(
  page: Page,
  view: "organization" | "directory",
  profile: "organizationProfileDocumentId" | "rosterProfileDocumentId",
) {
  const registration = page.waitForResponse(
    (response) =>
      response.url() === `${SIGNED_IN_API_URL}/auth/register` &&
      response.request().method() === "POST" &&
      response.ok(),
    { timeout: 60_000 },
  );
  await page.goto(`/app/org-manager/${view}`);
  await expect(
    page.getByRole("combobox", { name: "Organizations" }),
  ).toBeVisible({ timeout: 60_000 });
  const documentId = (await (await registration).json())[profile];
  if (typeof documentId !== "string" || !documentId) {
    throw new Error(`Registration did not return ${profile}`);
  }
  return `${SIGNED_IN_API_URL}/documents/${documentId}/sync`;
}

/** Hold only this profile's request so other documents can finish bootstrapping. */
async function withDocumentSyncHeld(
  page: Page,
  syncUrl: string,
  run: () => Promise<void>,
) {
  const release = Promise.withResolvers<void>();
  const hold = async (route: Route) => {
    await release.promise;
    await route.continue();
  };
  await page.route(syncUrl, hold);
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
  const syncUrl = await openProfile(
    page,
    "organization",
    "organizationProfileDocumentId",
  );
  const field = page.getByLabel("Organization name", { exact: true });
  await expect(field).toBeEditable({ timeout: 60_000 });
  const profile = page.getByRole("tab", { name: "Profile", exact: true });
  const cover = page
    .getByRole("status")
    .filter({ hasText: "Syncing organization profile" });
  await field.fill("Updated organization");
  await withDocumentSyncHeld(page, syncUrl, async () => {
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
  const syncUrl = await openProfile(
    page,
    "directory",
    "rosterProfileDocumentId",
  );
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
  await withDocumentSyncHeld(page, syncUrl, async () => {
    await first.press("Tab");
    await expect(last).toBeFocused();
    await expect(cover).toBeAttached();
    await expect(cover).toBeHidden();
    await last.fill("Last name draft");
  });
  await expect(cover).toHaveCount(0);
  await expect(last).toBeFocused();
  await expect(last).toHaveValue("Last name draft");

  await withDocumentSyncHeld(page, syncUrl, async () => {
    await last.press("Enter");
    await expect(cover).toBeVisible();
    await expect(copy).toBeHidden();
    await copy.focus();
    await expect(copy).not.toBeFocused();
  });
  await expect(copy).toBeVisible();
  await expect(last).toHaveValue("Last name draft");
});

import { expect, test } from "@playwright/test";
import { createFirstIdentity } from "./createFirstIdentity";
import { SIGNED_IN_APP_URL } from "./signedInServer";

test.use({ baseURL: SIGNED_IN_APP_URL, viewport: { width: 390, height: 844 } });

for (const app of ["explorer", "contacts", "notes"] as const) {
  test(`${app} explains a slow database startup on reload`, async ({
    context,
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/app/explorer");
    await createFirstIdentity(page);
    await expect(
      page.getByRole("button", { name: "Actions for Contacts" }),
    ).toBeVisible({ timeout: 30_000 });
    await page.goto(`/app/${app}`);
    const content =
      app === "explorer"
        ? page.getByRole("button", { name: "Actions for Contacts" })
        : app === "contacts"
          ? page.getByRole("button", { name: /Bob/ }).first()
          : page.getByRole("button", { name: /Create one/i });
    await expect(content).toBeVisible({ timeout: 30_000 });
    const requested = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    await context.route("**/sqlite3.wasm", async (route) => {
      requested.resolve();
      await release.promise;
      await route.continue();
    });
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      await requested.promise;
      await expect(
        page.locator(".mini-app-state-panel--busy").first(),
      ).toBeVisible();
      await expect(content).toBeHidden();
      await expect(page.getByText("No folders on this device")).toHaveCount(0);
    } finally {
      release.resolve();
    }
    await expect(content).toBeVisible({ timeout: 30_000 });
  });
}

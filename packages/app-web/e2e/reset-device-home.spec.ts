import { expect, test } from "@playwright/test";
import { createFirstIdentity } from "./createFirstIdentity";
import { SIGNED_IN_APP_URL } from "./signedInServer";

/*
 * A device reset used to reload the route it was requested from, so the fresh
 * device set up its first identity inside Identity Manager and left the user
 * there. It restarts at the home route instead: the new identity lands on
 * Explorer's root, as on a new install.
 */

test.use({ baseURL: SIGNED_IN_APP_URL, viewport: { width: 390, height: 844 } });

test("a reset device sets up its new identity on Explorer's root", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/app/identity-manager/local-data");
  await createFirstIdentity(page);
  // Creating an identity leaves the user where they made it.
  await page.getByRole("button", { name: "Reset Device" }).first().click();
  await expect(page).toHaveURL(/\/app\/identity-manager\/local-data$/u);
  const confirm = page.getByRole("dialog", { name: "Reset this device" });
  await confirm.getByRole("textbox").fill("Reset device");
  await confirm.getByRole("button", { name: "Reset Device" }).click();

  await expect(page).toHaveURL(new URL("/", SIGNED_IN_APP_URL).href, {
    timeout: 30_000,
  });
  await createFirstIdentity(page);

  await expect(
    page.getByRole("button", { name: "Actions for Contacts" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(new URL("/", SIGNED_IN_APP_URL).href);
});

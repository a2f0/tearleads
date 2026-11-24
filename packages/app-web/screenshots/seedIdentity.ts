import { expect, type Page } from "@playwright/test";
import { openWindowedApp, visiblePane, waitForBooted } from "./appShell";

// Imports the fixed recovery-key passphrase the seed setup registered and seeded
// on this project's API, via the shipping identity-manager mini-app ("Restore
// from Passphrase").
//
// Only this identity can sign in to the seeded account, and only its signing
// key re-derives the Contacts system slot the seeded Contacts container
// carries, so the Contacts mini-app can resolve that container once the
// account's documents download.
export async function importSeedIdentity(
  page: Page,
  routed: boolean,
  passphrase: string,
): Promise<void> {
  // The mini-app is sectioned (see mini-apps/identity-manager/sections.ts) and
  // only the Recovery Key section renders the restore form. The routed shell
  // keeps the section in the URL, so ask for it directly; the windowed shell
  // holds it in component state, so the section has to be clicked.
  if (routed) {
    await page.goto("/app/identity-manager/recovery-key");
    await waitForBooted(page);
  } else {
    await openWindowedApp(page, "Identity Manager");
    // The section is reachable from the window's sidebar or, on a narrow
    // window, from the in-body section menu; both render the same label and
    // both just set the view, so take whichever this window put up.
    await visiblePane(page)
      .getByRole("button", { name: "Recovery Key", exact: true })
      .first()
      .click();
  }

  // Recovery Key opens on the Backup tab, while importing an existing key
  // lives on the Recovery tab. Select it explicitly before locating the form.
  await page.getByRole("tab", { name: "Recovery", exact: true }).click();

  // The section renders two textareas with the same class (the read-only current
  // recovery key + this restore input); target the restore one by its label.
  await page
    .getByRole("textbox", { name: "Restore passphrase" })
    .fill(passphrase);
  await page.getByRole("button", { name: "Restore from Passphrase" }).click();
  await expect(page.getByText("Recovery key restored.")).toBeVisible({
    timeout: 30_000,
  });

  if (!routed) {
    // Close the identity-manager window so the desktop is empty for the sign-in
    // step, whose page-global locators would otherwise match across two
    // open windows.
    const pane = visiblePane(page);
    await pane.locator(".window").first().locator(".window-close").click();
    await expect(pane.locator(".window")).toHaveCount(0);
  }
}

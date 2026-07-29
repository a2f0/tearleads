import { expect, type Page } from "@playwright/test";
import { openWindowedApp, visiblePane, waitForBooted } from "./appShell";

// Imports the fixed recovery-key passphrase the seed artifact was authored under,
// via the shipping identity-manager mini-app ("Restore from Passphrase").
//
// This MUST run before restoring the backup. Restore writes into the ACTIVE
// identity's database, and only this identity's signing key re-derives the
// Contacts system slot the seeded Contacts container carries — so importing it
// first is what lets the Contacts mini-app resolve that container after reload.
// (Notes/Explorer surface their documents by kind and would work without it; the
// Contacts app would not.)
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
    // Close the identity-manager window so the later backup-restore window is the
    // only one on the desktop; page-global locators (the Restore tab, file input,
    // password field) would otherwise be ambiguous across two open windows.
    const pane = visiblePane(page);
    await pane.locator(".window").first().locator(".window-close").click();
    await expect(pane.locator(".window")).toHaveCount(0);
  }
}

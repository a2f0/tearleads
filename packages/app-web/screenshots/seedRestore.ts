import { expect, type Page } from "@playwright/test";

// Drives the shipping backup-restore mini-app (packages/app/src/mini-apps/
// backup-restore) to load the committed seed artifact into the live context.
// Assumes the backup-restore app is already open/visible.
//
// Two behaviours of the panel are load-bearing here:
//   - the restore password field + submit button only mount on the "Restore"
//     tab (default is "Backup"), so the tab must be selected first;
//   - the chosen file's body is read via an async file.text(), and the submit
//     no-ops with an error until that read resolves — so we retry the submit
//     until the success status confirms it.
export async function restoreSeedBackup(
  page: Page,
  options: { artifactPath: string; password: string },
): Promise<void> {
  await page.getByRole("tab", { name: "Restore" }).click();
  await page
    .locator('input[aria-label="Backup Restore File"]')
    .setInputFiles(options.artifactPath);
  await page.locator('input[type="password"]').fill(options.password);

  const restoreButton = page.getByRole("button", { name: "Restore Backup" });
  await expect(async () => {
    await restoreButton.click();
    await expect(page.getByText(/Backup restored:/)).toBeVisible({
      timeout: 3_000,
    });
  }).toPass({ timeout: 30_000 });
}

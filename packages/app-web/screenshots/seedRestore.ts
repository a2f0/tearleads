import { expect, type Page } from "@playwright/test";

// Drives the shipping backup-restore mini-app (packages/app/src/mini-apps/
// backup-restore) to load the committed seed artifact into the live context.
// Assumes the backup-restore app is already open/visible.
//
// Two behaviours of the panel are load-bearing here:
//   - the restore password field + submit button only mount on the "Restore"
//     tab (default is "Backup"), so the tab must be selected first;
//   - the chosen file's body is read via an async file.text(), and the submit
//     no-ops with a "Choose a backup file." error until that read resolves — so
//     the submit is retried until the success status confirms it.
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
  const restored = page.getByText(/Backup restored:/);

  // Retry the submit ONLY while the success line is absent. A concurrent restore
  // is not possible (the handler bails unless both file text + password are
  // present, and clears both on success), but re-clicking AFTER success resets
  // the panel and would clear the success line — so once it shows, stop clicking.
  await expect(async () => {
    if (!(await restored.isVisible())) {
      await restoreButton.click();
    }
    await expect(restored).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
}

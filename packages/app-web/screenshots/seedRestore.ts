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
  const needsFile = page.getByText("Choose a backup file.");

  // Submit once, then retry ONLY when the panel shows "Choose a backup file." —
  // positive evidence the previous submit no-op'd because the async file.text()
  // read had not resolved yet (it has by the next attempt). This never re-clicks
  // while a restore is in flight (the button is disabled then) or after it
  // succeeds (the success line, not the error, is shown), so a stray click can't
  // reset the panel and clear the success line.
  await restoreButton.click();
  await expect(async () => {
    if (await needsFile.isVisible()) {
      await restoreButton.click();
    }
    await expect(restored).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

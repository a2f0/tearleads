import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./appTest";
import { openWindowedDesktop } from "./windowedDesktop";

/*
 * Explorer's Outgoing tab lists the write queue and this session's uploads in
 * one table, joined so a file appears once. The upload history lives in memory
 * for the session, so the tab is reached from the Sync Status popover rather
 * than a page load, which would start a new session with no uploads to join.
 */

const FILE_NAME = "outgoing-once.txt";
// A text file imports as a note titled by its first line, which is the name
// its write-queue entry carries; the joined row takes the file's name.
const NOTE_TITLE = "Leaves this device once";

async function openExplorerWindow(page: Page): Promise<Locator> {
  await openWindowedDesktop(page);
  await page.locator(".pane-footer-menu-button").first().click();
  await page
    .locator(".menu")
    .getByRole("button", { name: "Explorer", exact: true })
    .click();
  const window = page.locator(".window").first();
  await expect(window).toBeVisible({ timeout: 30_000 });
  return window;
}

test("a file uploaded in Explorer is one Outgoing row with its queued writes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const explorer = await openExplorerWindow(page);

  const upload = explorer.getByRole("button", { name: "Upload", exact: true });
  await expect(upload).toBeEnabled({ timeout: 30_000 });
  const chooser = page.waitForEvent("filechooser");
  await upload.click();
  await (await chooser).setFiles({
    buffer: Buffer.from(`${NOTE_TITLE}\n`),
    mimeType: "text/plain",
    name: FILE_NAME,
  });
  await expect(
    explorer
      .locator(".explorer-item-row-button", { hasText: NOTE_TITLE })
      .first(),
  ).toBeVisible({ timeout: 20_000 });

  // Signed out, nothing syncs, so the file's create stays queued.
  await page
    .getByRole("button", { name: /not yet synced/ })
    .first()
    .click();
  await page.getByRole("button", { name: "View write queue" }).click();

  const table = page.getByRole("table", { name: "Outgoing" });
  const rows = table.getByRole("row").filter({ hasText: FILE_NAME });
  await expect(rows).toHaveCount(1, { timeout: 30_000 });
  const row = rows.first();
  await expect(row).toContainText("remote create");
  await expect(
    row.getByRole("button", { name: `Write queue actions: ${FILE_NAME}` }),
  ).toBeVisible();
  // The note's entry is that row, not a second one.
  await expect(
    table.getByRole("row").filter({ hasText: NOTE_TITLE }),
  ).toHaveCount(0);
});

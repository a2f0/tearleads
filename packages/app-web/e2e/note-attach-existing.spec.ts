import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./appTest";
import { openWindowedDesktop } from "./windowedDesktop";

/*
 * "Attach Existing" on a note in the Explorer opens the blob browser as a
 * picker and returns to the note with the chosen blob. The picker is a step on
 * the way, not a place: once the pick lands, Back from the note leaves the
 * note for wherever the user was before it, and never reopens the blob
 * browser. Measured in both shells, because each keeps its own Back stack:
 * browser history in the routed shell, the window's route history in a window.
 */

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function createNote(scope: Page | Locator): Promise<Locator> {
  await scope
    .getByRole("button", { name: "New Document" })
    .first()
    .click({ timeout: 30_000 });
  await scope.getByRole("button", { name: "Note", exact: true }).click();
  const editor = scope.getByRole("textbox", { name: "Notes editor" });
  await expect(editor).toBeEditable({ timeout: 30_000 });
  return editor;
}

/** A note holding an image, so the picker has a blob to offer the next note. */
async function createNoteWithImage(scope: Page | Locator): Promise<void> {
  await createNote(scope);
  await scope.locator(".note-document-file-input").setInputFiles({
    buffer: PIXEL_PNG,
    mimeType: "image/png",
    name: "pixel.png",
  });
  await expect(scope.getByText("pixel.png")).toBeVisible({ timeout: 30_000 });
}

async function attachExisting(scope: Page | Locator): Promise<void> {
  await scope
    .getByRole("button", { name: "Attach Existing" })
    .click({ timeout: 30_000 });
  await expect(scope.getByText("Choose Blob", { exact: true })).toBeVisible();
  await scope.getByText("pixel.png").first().click();
  // Back on the note, with the picked blob attached.
  await expect(
    scope.getByRole("textbox", { name: "Notes editor" }),
  ).toBeEditable({ timeout: 30_000 });
  await expect(scope.getByText("Choose Blob", { exact: true })).toHaveCount(0);
  await expect(scope.getByText("pixel.png")).toBeVisible();
}

test("routed Back from a note skips the blob picker it attached from", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/explorer");
  await createNoteWithImage(page);

  await page.goto("/app/explorer");
  await createNote(page);
  const noteUrl = page.url();
  await attachExisting(page);
  expect(page.url()).toBe(noteUrl);

  // One step back leaves the note for the listing it was created from.
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "New Document" }).first(),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/app/explorer");
});

test("a window's Back from a note skips the blob picker it attached from", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openWindowedDesktop(page);
  await page.locator(".pane-footer-menu-button").first().click();
  await page
    .locator(".menu")
    .getByRole("button", { name: "Explorer", exact: true })
    .click();
  const window = page.locator(".window").first();
  const back = window.getByRole("button", { name: "Back", exact: true });
  await createNoteWithImage(window);
  await back.click();

  await createNote(window);
  await attachExisting(window);

  await back.click();
  await expect(
    window.getByRole("button", { name: "New Document" }).first(),
  ).toBeVisible();
  await expect(
    window.getByRole("textbox", { name: "Notes editor" }),
  ).toHaveCount(0);
  await expect(window.getByText("pixel.png")).toHaveCount(0);
});

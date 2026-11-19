import type { Locator, Page } from "@playwright/test";
import { showExplorerSidebar } from "../screenshots/appShell";
import { expect, test } from "./appTest";
import { SIGNED_IN_API_URL, SIGNED_IN_APP_URL } from "./signedInServer";
import { openWindowedDesktop } from "./windowedDesktop";

/*
 * A note in the Trash is read-only. A fresh signed-out device has no verified
 * root to resolve its Trash from, so this spec runs against the signed-in
 * server (see signedInServer.ts): appTest names the new identity, which
 * registers it and logs it in.
 */
test.use({ baseURL: SIGNED_IN_APP_URL });

const NOTE_TEXT = "Groceries for the week";

async function createExplorerNote(page: Page): Promise<Locator> {
  const loggedIn = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.origin === SIGNED_IN_API_URL &&
        response.request().method() === "POST" &&
        url.pathname === "/auth/verify" &&
        response.status() === 200
      );
    },
    { timeout: 60_000 },
  );
  await openWindowedDesktop(page);
  await page.locator(".pane-footer-menu-button").first().click();
  await page
    .locator(".menu")
    .getByRole("button", { name: "Explorer", exact: true })
    .click();
  const window = page.locator(".window").first();
  // The name prompt holds the Explorer until appTest answers it; naming the
  // identity is what registers it, so the login lands after this.
  const newDocument = window.getByRole("button", { name: "New Document" });
  await expect(newDocument).toBeEnabled({ timeout: 60_000 });
  await loggedIn;
  await expect(window.locator(".explorer-sidebar-viewport")).toHaveCount(0);
  await showExplorerSidebar(window);
  await newDocument.click();
  await window.getByRole("button", { name: "Note", exact: true }).click();
  const editor = window.getByRole("textbox", { name: "Notes editor" });
  await expect(editor).toBeEditable();
  await editor.fill(NOTE_TEXT);
  return window;
}

async function moveNoteToTrashAndOpenIt(page: Page, window: Locator) {
  await window
    .locator(".explorer-sidebar")
    .getByRole("button", { name: "/", exact: true })
    .click();
  const table = window.getByRole("table", { name: "Items in /", exact: true });
  await table
    .getByRole("button", { name: NOTE_TEXT, exact: true })
    .click({ button: "right" });
  await page
    .locator(".menu")
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await window
    .locator(".explorer-sidebar-item")
    .filter({ hasText: "Trash" })
    .click();
  await window
    .getByRole("table", { name: "Items in Trash", exact: true })
    .getByRole("button", { name: NOTE_TEXT, exact: true })
    .click();
}

test("a note in the Trash is plain text that cannot take a caret", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const window = await createExplorerNote(page);
  const editor = window.getByRole("textbox", { name: "Notes editor" });
  const editorBox = await editor.boundingBox();
  const editorFont = await editor.evaluate(
    (element) => getComputedStyle(element).font,
  );

  await moveNoteToTrashAndOpenIt(page, window);

  const body = window.getByRole("article", { name: "Note (read only)" });
  await expect(body).toHaveText(NOTE_TEXT);
  // No textbox: a read-only textarea would take focus and show a caret while
  // ignoring every key.
  await expect(window.getByRole("textbox")).toHaveCount(0);
  await body.click();
  expect(
    await page.evaluate(() => {
      const active = document.activeElement;
      return (
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLInputElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      );
    }),
  ).toBe(false);
  await page.keyboard.type("more");
  await expect(body).toHaveText(NOTE_TEXT);

  // The text sits exactly where the editor drew it.
  expect(await body.boundingBox()).toEqual(editorBox);
  expect(await body.evaluate((element) => getComputedStyle(element).font)).toBe(
    editorFont,
  );
});

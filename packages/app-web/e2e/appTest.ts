import { test as base, expect, type Page } from "@playwright/test";

export { expect };

const ACCOUNT_NAME = "Bob";
const handlers = new WeakMap<Page, Promise<void>>();

/**
 * Every fresh page boots a new identity, and until it is named the
 * "What should we call you?" prompt holds each mini-app behind the keyring
 * gate. Playwright answers it whenever it shows before an action or an
 * auto-waiting assertion, then hands focus back to whatever held it, so specs
 * read as if it were already answered.
 */
function answerAccountNamePrompt(page: Page): Promise<void> {
  let handler = handlers.get(page);
  if (!handler) {
    handler = page.addLocatorHandler(
      page.getByRole("textbox", { name: "What should we call you?" }).first(),
      async (prompt) => {
        const focused = await page.evaluateHandle(() => document.activeElement);
        await prompt.fill(ACCOUNT_NAME);
        await prompt.press("Enter");
        await focused.evaluate((element) => {
          if (element instanceof HTMLElement && element.isConnected) {
            element.focus();
          }
        });
        await focused.dispose();
      },
    );
    handlers.set(page, handler);
  }
  return handler;
}

/** Playwright's `test`, answering the first-launch name prompt on every page. */
export const test = base.extend({
  context: async ({ context }, use) => {
    context.on("page", (page) => void answerAccountNamePrompt(page));
    await use(context);
  },
  page: async ({ page }, use) => {
    await answerAccountNamePrompt(page);
    await use(page);
  },
});

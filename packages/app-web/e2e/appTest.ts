import { test as base, expect, type Page } from "@playwright/test";

export { expect };

const ACCOUNT_NAME = "Bob";
const handlers = new WeakMap<Page, Promise<void>>();

/**
 * Fresh profiles wait for a choice and a name before creating an identity.
 * Playwright handles both prompts when they appear before an action or an
 * auto-waiting assertion, then hands focus back to whatever held it, so specs
 * read as if it were already answered.
 */
function answerAccountNamePrompt(page: Page): Promise<void> {
  let handler = handlers.get(page);
  if (!handler) {
    handler = (async () => {
      await page.addLocatorHandler(
        page
          .getByRole("button", { name: "Create new identity", exact: true })
          .first(),
        async (button) => {
          await button.click();
        },
      );
      await page.addLocatorHandler(
        page.getByRole("textbox", { name: "What should we call you?" }).first(),
        async (prompt) => {
          const focused = await page.evaluateHandle(
            () => document.activeElement,
          );
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
    })();
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

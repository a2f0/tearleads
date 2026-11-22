import {
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { BACKUP_AGREEMENT_LABEL } from "./createFirstIdentity";

export { expect };

const ACCOUNT_NAME = "Bob";
const handlers = new WeakMap<Page, Promise<void>>();

/** Answers a text prompt, then hands focus back to whatever held it. */
async function answerPrompt(
  page: Page,
  prompt: Locator,
  answer: string,
): Promise<void> {
  const focused = await page.evaluateHandle(() => document.activeElement);
  await prompt.fill(answer);
  await prompt.press("Enter");
  await focused.evaluate((element) => {
    if (element instanceof HTMLElement && element.isConnected) {
      element.focus();
    }
  });
  await focused.dispose();
}

/**
 * Fresh profiles wait for a choice and a name before creating an identity,
 * then for the agreement that its recovery key is backed up. Playwright
 * handles each prompt when it appears before an action or an auto-waiting
 * assertion, so specs read as if they were already answered.
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
        (prompt) => answerPrompt(page, prompt, ACCOUNT_NAME),
      );
      await page.addLocatorHandler(
        page.getByLabel(BACKUP_AGREEMENT_LABEL).first(),
        (agreement) => answerPrompt(page, agreement, "I agree"),
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

import type { Page } from "@playwright/test";

/** Complete first-launch creation through the visible onboarding controls. */
export async function createFirstIdentity(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Create new identity", exact: true })
    .first()
    .click();
  const prompt = page
    .getByRole("textbox", { name: "What should we call you?" })
    .first();
  await prompt.fill("Bob");
  await prompt.press("Enter");
}

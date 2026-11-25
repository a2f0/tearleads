import type { Locator, Page } from "@playwright/test";

/**
 * The agreement's checkbox, as the app labels it: a new identity's
 * registration, and the demo's panes, wait for it.
 */
export function legalTermsAgreement(page: Page): Locator {
  return page
    .getByRole("checkbox", {
      name: "I agree to the Terms of Service and Privacy Policy",
    })
    .first();
}

/** Checks the agreement, then continues past it. */
export async function agreeToLegalTerms(agreement: Locator): Promise<void> {
  await agreement.check();
  await agreement
    .locator("xpath=ancestor::form")
    .getByRole("button", { name: "Continue" })
    .click();
}

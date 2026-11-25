import type { Page } from "@playwright/test";
import { agreeToLegalTerms, legalTermsAgreement } from "./legalTermsAgreement";

/** Labels the new identity's recovery key backup agreement. */
export const BACKUP_AGREEMENT_LABEL = /Type I agree to confirm/u;

/** Complete first-launch creation through the visible onboarding controls. */
export async function createFirstIdentity(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Create new identity", exact: true })
    .first()
    .click();
  await agreeToLegalTerms(legalTermsAgreement(page));
  const prompt = page
    .getByRole("textbox", { name: "What should we call you?" })
    .first();
  await prompt.fill("Bob");
  await prompt.press("Enter");
  const agreement = page.getByLabel(BACKUP_AGREEMENT_LABEL).first();
  await agreement.fill("I agree");
  await agreement.press("Enter");
}

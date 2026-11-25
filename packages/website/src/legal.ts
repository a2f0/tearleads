import { legalContactDetails } from "@tearleads/ui/legal";
import { LEGAL_TERMS_VERSION } from "@tearleads/validators/legalTerms";

/**
 * Both documents' shared effective date is the revision a registration agrees
 * to. Update the documents (in `@tearleads/ui/legal`) and the revision together
 * after the publication review in LEGAL_REVIEW.md.
 */
const updatedAt = LEGAL_TERMS_VERSION;

export const legalDetails = {
  ...legalContactDetails,
  updatedAt,
  updatedLabel: new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${updatedAt}T00:00:00Z`)),
  isDraft: false,
} as const;

export function shouldShowLegalDocument(input: {
  readonly isDraft: boolean;
  readonly isDevelopment: boolean;
  readonly environment: string | undefined;
}): boolean {
  return (
    !input.isDraft ||
    (input.environment !== "production" &&
      (input.isDevelopment || input.environment === "staging"))
  );
}

/** Update both documents together after the publication review in LEGAL_REVIEW.md. */
const updatedAt = "2026-09-14";

export const legalDetails = {
  operator: "Tearleads, LLC",
  location: "Chattanooga, Tennessee, United States",
  email: "legal@tearleads.com",
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

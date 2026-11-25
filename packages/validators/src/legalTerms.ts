/**
 * The published revision of the Privacy Policy and Terms of Service, which are
 * reviewed and adopted together: their shared effective date (`YYYY-MM-DD`).
 *
 * The website shows it as both documents' effective date, apps show it beside
 * the agreement a new identity checks, and a registration names it as the
 * revision its user agreed to. The API registers only this revision, so after
 * a change a client registers only once it shows its users the new one. Change
 * it only through the publication review in `packages/website/LEGAL_REVIEW.md`.
 */
export const LEGAL_TERMS_VERSION = "2026-10-22";

/** A registration's legal terms version is a `YYYY-MM-DD` revision date. */
export const LEGAL_TERMS_VERSION_MAX_LENGTH = 10;

/** Where the website publishes the documents {@link LEGAL_TERMS_VERSION} names. */
export const LEGAL_DOCUMENT_URLS = {
  privacyPolicy: "https://tearleads.com/privacy-policy/",
  termsOfService: "https://tearleads.com/terms-of-service/",
} as const;

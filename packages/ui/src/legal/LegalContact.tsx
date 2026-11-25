import { legalContactDetails } from "./legalContactDetails";

/** The operator's name, location, and legal mailbox. */
export function LegalContact() {
  return (
    <address className="legal-contact">
      <strong>{legalContactDetails.operator}</strong>
      <span>{legalContactDetails.location}</span>
      <a href={`mailto:${legalContactDetails.email}`}>
        {legalContactDetails.email}
      </a>
    </address>
  );
}

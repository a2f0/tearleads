import {
  type LegalDocumentProps,
  legalDocumentSectionProps,
} from "../legalDocumentProps";
import { TermsOfServiceLimits } from "./TermsOfServiceLimits";
import { TermsOfServiceUse } from "./TermsOfServiceUse";

/** The Terms of Service's sections, in order, for a table of contents. */
export const TERMS_OF_SERVICE_SECTIONS = [
  { id: "agreement", label: "The agreement" },
  { id: "service", label: "Using Tearleads" },
  { id: "keys", label: "Keys & backups" },
  { id: "content", label: "Your content & sharing" },
  { id: "acceptable-use", label: "Acceptable use" },
  { id: "billing", label: "Subscriptions & billing" },
  { id: "ending-service", label: "Ending service" },
  { id: "availability", label: "Availability & warranties" },
  { id: "liability", label: "Limits on liability" },
  { id: "disputes", label: "Law & disputes" },
  { id: "changes", label: "Changes & general terms" },
  { id: "contact", label: "Contact us" },
] as const;

/**
 * The Terms of Service's text, published on the website at `/terms-of-service/` and shown
 * in the apps before a new identity agrees to it. Both render this component,
 * so what an identity agrees to is the published text. Revise it only through
 * the publication review in `packages/website/LEGAL_REVIEW.md`, which also
 * moves `LEGAL_TERMS_VERSION` in `@tearleads/validators/legalTerms`.
 */
export function TermsOfServiceDocument(props: LegalDocumentProps) {
  const sectionProps = legalDocumentSectionProps(props);
  return (
    <>
      <TermsOfServiceUse {...sectionProps} />
      <TermsOfServiceLimits {...sectionProps} />
    </>
  );
}

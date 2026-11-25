import {
  type LegalDocumentProps,
  legalDocumentSectionProps,
} from "../legalDocumentProps";
import { PrivacyPolicyChoices } from "./PrivacyPolicyChoices";
import { PrivacyPolicyHandling } from "./PrivacyPolicyHandling";

/** The Privacy Policy's sections, in order, for a table of contents. */
export const PRIVACY_POLICY_SECTIONS = [
  { id: "scope", label: "Who we are" },
  { id: "information", label: "Information we handle" },
  { id: "purposes", label: "How we use information" },
  { id: "encryption", label: "Encryption & sharing" },
  { id: "providers", label: "Providers & disclosures" },
  { id: "device-storage", label: "Cookies & device storage" },
  { id: "retention", label: "Retention & deletion" },
  { id: "rights", label: "Your choices & rights" },
  { id: "international", label: "International processing" },
  { id: "children", label: "Children’s privacy" },
  { id: "updates", label: "Policy updates" },
  { id: "contact", label: "Contact us" },
] as const;

/**
 * The Privacy Policy's text, published on the website at `/privacy-policy/` and shown
 * in the apps before a new identity agrees to it. Both render this component,
 * so what an identity agrees to is the published text. Revise it only through
 * the publication review in `packages/website/LEGAL_REVIEW.md`, which also
 * moves `LEGAL_TERMS_VERSION` in `@tearleads/validators/legalTerms`.
 */
export function PrivacyPolicyDocument(props: LegalDocumentProps) {
  const sectionProps = legalDocumentSectionProps(props);
  return (
    <>
      <PrivacyPolicyHandling {...sectionProps} />
      <PrivacyPolicyChoices {...sectionProps} />
    </>
  );
}

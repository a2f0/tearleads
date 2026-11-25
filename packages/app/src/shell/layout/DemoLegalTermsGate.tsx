import { LEGAL_TERMS_VERSION } from "@tearleads/validators/legalTerms";
import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useState,
} from "react";
import { LegalTermsAgreementPanel } from "../../components/identity/legal-terms/LegalTermsAgreementPanel";
import { useLegalTermsAgreement } from "../../identity/legalTermsAgreement";
import "./DemoLegalTermsGate.css";

/** The revision this device agreed to in the demo, if any. */
export const DEMO_LEGAL_TERMS_STORAGE_KEY = "tearleads.demo.legal-terms";

function storedAgreement(): boolean {
  try {
    return (
      globalThis.localStorage?.getItem(DEMO_LEGAL_TERMS_STORAGE_KEY) ===
      LEGAL_TERMS_VERSION
    );
  } catch {
    return false;
  }
}

function storeAgreement(): void {
  try {
    globalThis.localStorage?.setItem(
      DEMO_LEGAL_TERMS_STORAGE_KEY,
      LEGAL_TERMS_VERSION,
    );
  } catch {
    // Unstored, the next visit asks again; this one goes on.
  }
}

/**
 * The demo's panes create and register their identities on their own, side by
 * side, with no onboarding to ask in. So the demo asks once, for the page,
 * before either pane starts: a pane's runtime mounts only after the person
 * agrees, and every identity it registers records that agreement.
 *
 * The panes keep their identities on this device, so the agreement is kept
 * there too, for the revision agreed to: a later visit restores those panes
 * without asking again, until the documents change.
 */
export function DemoLegalTermsGate({ children }: PropsWithChildren) {
  const { agree, agreedVersion } = useLegalTermsAgreement();
  const [agreedBefore] = useState(storedAgreement);
  useEffect(() => {
    if (agreedBefore) agree();
  }, [agree, agreedBefore]);
  const agreeOnThisDevice = useCallback(() => {
    storeAgreement();
    agree();
  }, [agree]);

  if (agreedVersion !== null) return children;
  // The stored agreement lands in the effect above; until then, mount nothing
  // so no pane starts before it.
  if (agreedBefore) return null;
  return (
    <div className="demo-legal-terms-gate">
      <LegalTermsAgreementPanel onAgree={agreeOnThisDevice} />
    </div>
  );
}

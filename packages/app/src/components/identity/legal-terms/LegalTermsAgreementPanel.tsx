import {
  PrivacyPolicyDocument,
  TermsOfServiceDocument,
} from "@tearleads/ui/legal";
import { LEGAL_DOCUMENT_URLS } from "@tearleads/validators/legalTerms";
import { type FormEvent, useId, useState } from "react";
import { accountBootstrapCopy } from "../../../identity/accountBootstrapPhase";
import {
  MiniAppButton,
  MiniAppCheckbox,
  MiniAppStatePanel,
  type MiniAppTabDescriptor,
  MiniAppTabList,
  MiniAppTabPanel,
  MiniAppToolbar,
} from "../../mini-app/MiniAppLayout";
import { useMiniAppDetailBackAction } from "../../mini-app/useMiniAppDetailBackAction";
import { useExternalDocumentLinks } from "./useExternalDocumentLinks";
import "./LegalTermsAgreementPanel.css";

type LegalDocumentTab = "terms-of-service" | "privacy-policy";

const LEGAL_DOCUMENT_TABS: ReadonlyArray<
  MiniAppTabDescriptor<LegalDocumentTab>
> = [
  { id: "terms-of-service", label: "Terms of Service" },
  { id: "privacy-policy", label: "Privacy Policy" },
];

/** The agreement's label, also what a test or a screen reader finds it by. */
export const LEGAL_TERMS_AGREEMENT_LABEL =
  "I agree to the Terms of Service and Privacy Policy";

const LEGAL_TERMS_COPY = accountBootstrapCopy("accepting-terms");

// The documents link to each other and to other website pages by path, which
// the website serves; the app resolves them against the published site.
const SITE_ORIGIN = new URL(LEGAL_DOCUMENT_URLS.termsOfService).origin;
function siteHref(path: string): string {
  return new URL(path, SITE_ORIGIN).href;
}

/**
 * Shows the Terms of Service and Privacy Policy a new identity's registration
 * agrees to, in the text the website publishes, and asks the person to check
 * that they agree before `onAgree` lets them continue. `onBack` returns to
 * the step before, when there is one.
 */
export function LegalTermsAgreementPanel({
  onAgree,
  onBack,
}: {
  readonly onAgree: () => void;
  readonly onBack?: (() => void) | null | undefined;
}) {
  const idPrefix = useId();
  const checkboxId = `${idPrefix}-agree`;
  const [tab, setTab] = useState<LegalDocumentTab>("terms-of-service");
  const [agreed, setAgreed] = useState(false);
  const documentRef = useExternalDocumentLinks<HTMLDivElement>();
  // A phase of onboarding, not a route: register the toolbar Back like the
  // identity form does, so the host's own Back leaves the step too.
  useMiniAppDetailBackAction(
    onBack ? { label: "Back", onBack, priority: 200 } : null,
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (agreed) onAgree();
  };

  // The outer box is the size container the layout's breakpoints query: a
  // window, a pane, or the demo's page can each be wide or narrow on its own.
  return (
    <div className="legal-terms-agreement">
      <MiniAppStatePanel
        className="legal-terms-agreement-panel"
        description={LEGAL_TERMS_COPY?.description}
        title={LEGAL_TERMS_COPY?.title}
      >
        <div className="legal-terms-agreement-documents" ref={documentRef}>
          <MiniAppTabList
            activeTab={tab}
            idPrefix={idPrefix}
            label="Legal documents"
            onSelect={setTab}
            tabs={LEGAL_DOCUMENT_TABS}
          />
          <MiniAppTabPanel
            activeTab={tab}
            className="legal-terms-agreement-document"
            idPrefix={idPrefix}
          >
            {tab === "terms-of-service" ? (
              <TermsOfServiceDocument
                idPrefix={`${idPrefix}-terms-`}
                siteHref={siteHref}
              />
            ) : (
              <PrivacyPolicyDocument
                idPrefix={`${idPrefix}-privacy-`}
                siteHref={siteHref}
              />
            )}
          </MiniAppTabPanel>
        </div>
        <form className="legal-terms-agreement-form" onSubmit={submit}>
          <label className="legal-terms-agreement-check" htmlFor={checkboxId}>
            <MiniAppCheckbox
              checked={agreed}
              id={checkboxId}
              onChange={(event) => setAgreed(event.currentTarget.checked)}
            />
            <span>{LEGAL_TERMS_AGREEMENT_LABEL}</span>
          </label>
          <MiniAppToolbar>
            {onBack && (
              <MiniAppButton type="button" variant="ghost" onClick={onBack}>
                Back
              </MiniAppButton>
            )}
            <MiniAppButton disabled={!agreed} type="submit">
              Continue
            </MiniAppButton>
          </MiniAppToolbar>
        </form>
      </MiniAppStatePanel>
    </div>
  );
}

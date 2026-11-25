import { SystemTrayProvider } from "@tearleads/windowing";
import type { PropsWithChildren, ReactNode } from "react";
import {
  LegalTermsAgreementContext,
  type LegalTermsAgreementStore,
} from "../../src/identity/legalTermsAgreement";
import { DeveloperModeProvider } from "../../src/providers/developer-mode/DeveloperModeProvider";
import { TRAY_APPS } from "../../src/tray-apps/registry";

/**
 * Mirrors production composition: Layout mounts the system tray's provider and
 * the developer-mode provider above every Pane, so a pane rendered on its own
 * shows the same tray apps and developer mode.
 *
 * `legalTermsAgreement` stands in for the page's agreement, which the suite
 * has already given (see happydom.ts), so a test can start before it.
 */
export function AppLayoutTestProviders({
  children,
  legalTermsAgreement,
}: PropsWithChildren<{
  readonly legalTermsAgreement?: LegalTermsAgreementStore | undefined;
}>) {
  let tree: ReactNode = (
    <DeveloperModeProvider>{children}</DeveloperModeProvider>
  );
  if (legalTermsAgreement) {
    tree = (
      <LegalTermsAgreementContext.Provider value={legalTermsAgreement}>
        {tree}
      </LegalTermsAgreementContext.Provider>
    );
  }
  return (
    <SystemTrayProvider definition={TRAY_APPS} storageKey="test.tray.disabled">
      {tree}
    </SystemTrayProvider>
  );
}

import { LEGAL_TERMS_VERSION } from "@tearleads/validators/legalTerms";
import { createContext, useCallback, useContext } from "react";
import { useTearleadsExternalValue } from "../providers/sdk/useTearleadsSubscription";

/**
 * Whether the person using this page has agreed to the current Privacy Policy
 * and Terms of Service. Every identity this page registers carries the agreed
 * revision; the API records it, with the time of registration, on the
 * identity. Nothing registers before it is given.
 *
 * It is the page's, not one identity's: everything a page runs (every
 * workspace, and each of the demo's panes) is the one person in front of it.
 * It lives in memory, so a reload asks again before registering anything
 * else; only the demo, which asks before its panes start, keeps it on the
 * device (see `DemoLegalTermsGate`).
 */
export interface LegalTermsAgreementStore {
  /** The agreed revision, or null until the person agrees. */
  readonly agreedVersion: string | null;
  /** Records agreement to the revision this build shows. */
  agree(): void;
  subscribe(listener: () => void): () => void;
}

export function createLegalTermsAgreementStore(): LegalTermsAgreementStore {
  let agreedVersion: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get agreedVersion() {
      return agreedVersion;
    },
    agree() {
      if (agreedVersion === LEGAL_TERMS_VERSION) return;
      agreedVersion = LEGAL_TERMS_VERSION;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The page's agreement; every runtime the page mounts reads this one. */
const pageLegalTermsAgreement = createLegalTermsAgreementStore();

/**
 * Supplies the agreement surfaces read. The page's own store unless a test
 * provides a fresh one.
 */
export const LegalTermsAgreementContext =
  createContext<LegalTermsAgreementStore>(pageLegalTermsAgreement);

export interface LegalTermsAgreement {
  readonly agreedVersion: string | null;
  readonly agree: () => void;
}

/**
 * The page's store itself, for a caller that must read the agreement when it
 * acts rather than when it last rendered, such as registering straight after
 * the person agrees.
 */
export function useLegalTermsAgreementStore(): LegalTermsAgreementStore {
  return useContext(LegalTermsAgreementContext);
}

export function useLegalTermsAgreement(): LegalTermsAgreement {
  const store = useLegalTermsAgreementStore();
  const agreedVersion = useTearleadsExternalValue(
    store.subscribe,
    () => store.agreedVersion,
  );
  const agree = useCallback(() => store.agree(), [store]);
  return { agree, agreedVersion };
}

/**
 * Test support: agrees on the page's store, as a person would have before
 * any identity registered. Suites that exercise the agreement itself provide
 * a fresh store through {@link LegalTermsAgreementContext}.
 */
export function agreeToLegalTermsForTests(): void {
  pageLegalTermsAgreement.agree();
}

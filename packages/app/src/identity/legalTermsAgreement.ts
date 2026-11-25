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
 * It lives in memory, so a reload asks again before a new identity registers
 * (the demo, which asks before its panes start, keeps it on the device; see
 * `DemoLegalTermsGate`). Each key it covers keeps it on this device, though:
 * a key stored before it registered, say created offline, registers after a
 * relaunch with the revision agreed for it, instead of asking again and
 * holding every app until it does.
 */
export interface LegalTermsAgreementStore {
  /** The agreed revision, or null until the person agrees. */
  readonly agreedVersion: string | null;
  /** Records agreement to the revision this build shows. */
  agree(): void;
  /**
   * The revision registering this key carries: the page's agreement, or else
   * the current revision when this device keeps an agreement for the key.
   */
  agreedVersionFor(signingFingerprint: string | null): string | null;
  /** Keeps the page's agreement on this device for a key it now covers. */
  keepFor(signingFingerprint: string): void;
  subscribe(listener: () => void): () => void;
}

/** Where this device keeps, per signing key, the revision agreed for it. */
export const KEPT_LEGAL_TERMS_STORAGE_PREFIX = "tearleads.legal-terms:";

type KeptAgreementStorage = Pick<Storage, "getItem" | "setItem">;

function deviceStorage(): KeptAgreementStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createLegalTermsAgreementStore(
  storage: KeptAgreementStorage | null = deviceStorage(),
): LegalTermsAgreementStore {
  let agreedVersion: string | null = null;
  const listeners = new Set<() => void>();
  const keptFor = (signingFingerprint: string): string | null => {
    try {
      return storage?.getItem(
        `${KEPT_LEGAL_TERMS_STORAGE_PREFIX}${signingFingerprint}`,
      ) === LEGAL_TERMS_VERSION
        ? LEGAL_TERMS_VERSION
        : null;
    } catch {
      return null;
    }
  };
  return {
    get agreedVersion() {
      return agreedVersion;
    },
    agree() {
      if (agreedVersion === LEGAL_TERMS_VERSION) return;
      agreedVersion = LEGAL_TERMS_VERSION;
      for (const listener of listeners) listener();
    },
    agreedVersionFor(signingFingerprint) {
      if (agreedVersion !== null || signingFingerprint === null) {
        return agreedVersion;
      }
      return keptFor(signingFingerprint);
    },
    keepFor(signingFingerprint) {
      if (agreedVersion === null) return;
      try {
        storage?.setItem(
          `${KEPT_LEGAL_TERMS_STORAGE_PREFIX}${signingFingerprint}`,
          agreedVersion,
        );
      } catch {
        // Unkept, a relaunch asks again before this key registers.
      }
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

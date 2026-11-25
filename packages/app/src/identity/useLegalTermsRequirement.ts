import { useEffect, useMemo, useReducer } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../providers/db/DatabaseProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useTearleads } from "../providers/sdk/TearleadsProvider";
import {
  useLegalTermsAgreement,
  useLegalTermsAgreementStore,
} from "./legalTermsAgreement";
import {
  IDENTITY_ACCOUNT_BINDING_UNKNOWN,
  type LegalTermsRequirement,
  legalTermsRequirement,
  transitionIdentityAccountBinding,
} from "./legalTermsRequirement";

/**
 * The current identity's {@link LegalTermsRequirement}. A restored key whose
 * session names no user reads this device's binding once it could register
 * (its root container and database are ready). A failed read asks for the
 * terms, since registering would then need them. The page's agreement is kept
 * for the current key, so the key needs none after a relaunch.
 */
export function useLegalTermsRequirement(
  recovered: boolean,
): LegalTermsRequirement {
  const tearleads = useTearleads();
  const { client: dbClient } = useDatabase();
  const { containerId, userId } = useCryptoSession();
  const { localIdentityRestoredFingerprint, signingFingerprint } =
    useIdentity();
  const { agreedVersion } = useLegalTermsAgreement();
  const agreements = useLegalTermsAgreementStore();
  // Read again when the page agrees or the key changes; only an agreement the
  // page holds is kept, so nothing else changes the answer.
  const agreed = useMemo(
    () =>
      agreedVersion !== null ||
      agreements.agreedVersionFor(signingFingerprint) !== null,
    [agreedVersion, agreements, signingFingerprint],
  );
  const [binding, send] = useReducer(
    transitionIdentityAccountBinding,
    IDENTITY_ACCOUNT_BINDING_UNKNOWN,
  );
  const requirement = legalTermsRequirement({
    agreed,
    binding,
    identityRestored:
      signingFingerprint !== null &&
      localIdentityRestoredFingerprint === signingFingerprint,
    recovered,
    signingFingerprint,
  });
  const lookupFingerprint =
    requirement === "checking" &&
    !(
      binding.status === "checking" &&
      binding.fingerprint === signingFingerprint
    ) &&
    userId === null &&
    containerId !== null &&
    dbClient !== null
      ? signingFingerprint
      : null;

  useEffect(() => {
    if (agreedVersion !== null && signingFingerprint !== null) {
      agreements.keepFor(signingFingerprint);
    }
  }, [agreedVersion, agreements, signingFingerprint]);

  useEffect(() => {
    if (lookupFingerprint === null) return;
    const request = Symbol(lookupFingerprint);
    send({ fingerprint: lookupFingerprint, request, type: "check-started" });
    void tearleads.session
      .boundUserId()
      .then(
        (boundUserId) => boundUserId !== null,
        () => false,
      )
      .then((bound) => send({ bound, request, type: "check-settled" }));
  }, [lookupFingerprint, tearleads]);

  return requirement;
}

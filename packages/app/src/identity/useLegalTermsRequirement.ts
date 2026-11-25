import { useEffect, useReducer } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../providers/db/DatabaseProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useTearleads } from "../providers/sdk/TearleadsProvider";
import { useLegalTermsAgreement } from "./legalTermsAgreement";
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
 * terms, since registering would then need them.
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
  const [binding, send] = useReducer(
    transitionIdentityAccountBinding,
    IDENTITY_ACCOUNT_BINDING_UNKNOWN,
  );
  const requirement = legalTermsRequirement({
    agreed: agreedVersion !== null,
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

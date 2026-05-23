import { useCallback } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../providers/db/DatabaseProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useTearleads } from "../providers/sdk/TearleadsProvider";

interface RegisterCurrentIdentityResult {
  canRegisterCurrentIdentity: boolean;
  registerCurrentIdentity: () => Promise<boolean>;
}

export function useRegisterCurrentIdentity(): RegisterCurrentIdentityResult {
  const { client: dbClient } = useDatabase();
  const { userId, containerId, loginWithChallenge } = useCryptoSession();
  const { encapsulationKeyPair, signingKeyPair } = useIdentity();
  const tearleads = useTearleads();

  const canRegisterCurrentIdentity =
    signingKeyPair !== null &&
    encapsulationKeyPair !== null &&
    userId === null &&
    containerId !== null &&
    dbClient !== null;

  const registerCurrentIdentity = useCallback(async (): Promise<boolean> => {
    if (!canRegisterCurrentIdentity) {
      return false;
    }

    const response = await tearleads.session.registerIdentity();
    if (!response) {
      return false;
    }

    return loginWithChallenge(response.challenge);
  }, [canRegisterCurrentIdentity, loginWithChallenge, tearleads]);

  return { canRegisterCurrentIdentity, registerCurrentIdentity };
}

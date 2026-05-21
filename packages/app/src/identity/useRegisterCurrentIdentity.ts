import { registerIdentity } from "@tearleads/client-sdk/workflows/registration";
import { useCallback } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../providers/db/DatabaseProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useLog } from "../providers/logging/LogProvider";
import { useTearleads } from "../providers/sdk/TearleadsProvider";

interface RegisterCurrentIdentityResult {
  canRegisterCurrentIdentity: boolean;
  registerCurrentIdentity: () => Promise<boolean>;
}

export function useRegisterCurrentIdentity(): RegisterCurrentIdentityResult {
  const { client: dbClient } = useDatabase();
  const {
    userId,
    containerId,
    setUserId,
    setOrganizationId,
    loginWithChallenge,
  } = useCryptoSession();
  const { encapsulationKeyPair, signingKeyPair } = useIdentity();
  const { log, logError } = useLog();
  const tearleads = useTearleads();
  const apiClient = tearleads.api;

  const canRegisterCurrentIdentity =
    signingKeyPair !== null &&
    encapsulationKeyPair !== null &&
    userId === null &&
    containerId !== null;

  const registerCurrentIdentity = useCallback(async (): Promise<boolean> => {
    if (
      signingKeyPair === null ||
      encapsulationKeyPair === null ||
      userId !== null ||
      containerId === null
    ) {
      return false;
    }

    const response = await registerIdentity({
      apiClient,
      containerId,
      dbClient,
      encapsulationKeyPair,
      log,
      logError,
      signingKeyPair,
    });
    if (!response) {
      return false;
    }

    setUserId(response.userId);
    setOrganizationId(response.organizationId);
    await loginWithChallenge(response.challenge);
    return true;
  }, [
    apiClient,
    containerId,
    dbClient,
    encapsulationKeyPair,
    log,
    logError,
    loginWithChallenge,
    setOrganizationId,
    setUserId,
    signingKeyPair,
    userId,
  ]);

  return { canRegisterCurrentIdentity, registerCurrentIdentity };
}

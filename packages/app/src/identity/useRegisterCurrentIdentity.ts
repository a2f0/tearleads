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

async function registerCurrentIdentityWithSdk(input: {
  apiClient: ReturnType<typeof useTearleads>["api"];
  containerId: string;
  dbClient: ReturnType<typeof useDatabase>["client"];
  encapsulationKeyPair: NonNullable<
    ReturnType<typeof useIdentity>["encapsulationKeyPair"]
  >;
  log: (message: string) => void;
  logError: ReturnType<typeof useLog>["logError"];
  loginWithChallenge: (challenge: string) => Promise<boolean>;
  setOrganizationId: (organizationId: string | null) => void;
  setUserId: (userId: string | null) => void;
  signingKeyPair: NonNullable<ReturnType<typeof useIdentity>["signingKeyPair"]>;
}): Promise<boolean> {
  const response = await registerIdentity({
    apiClient: input.apiClient,
    containerId: input.containerId,
    dbClient: input.dbClient,
    encapsulationKeyPair: input.encapsulationKeyPair,
    log: input.log,
    logError: input.logError,
    signingKeyPair: input.signingKeyPair,
  });
  if (!response) {
    return false;
  }

  input.setUserId(response.userId);
  input.setOrganizationId(response.organizationId);
  await input.loginWithChallenge(response.challenge);
  return true;
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

    return registerCurrentIdentityWithSdk({
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
    });
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

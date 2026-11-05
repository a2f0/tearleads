import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../providers/db/DatabaseProvider";
import { useAppHostConfig } from "../providers/host/AppHostConfigProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../providers/local-keyring/LocalKeyringLockProvider";
import { useSystemBootstrap } from "../providers/system-bootstrap/SystemBootstrapProvider";
import {
  type AccountBootstrapCopy,
  type AccountBootstrapPhase,
  accountBootstrapCopy,
  resolveAccountBootstrapPhase,
} from "./accountBootstrapPhase";
import { useAutoProvisioningStatus } from "./autoProvisioningStatus";

/**
 * The current account's {@link AccountBootstrapPhase}, so a surface gated on
 * sign-in can show progress while the account is still being restored,
 * created, or signed in, instead of asking the user to log in.
 */
function useAccountBootstrapPhase(): AccountBootstrapPhase {
  const { features } = useAppHostConfig().profile;
  const { isLocked } = useLocalKeyringLock();
  const identity = useIdentity();
  const session = useCryptoSession();
  const { status: databaseStatus } = useDatabase();
  const { status: systemBootstrapStatus } = useSystemBootstrap();
  const autoProvisioning = useAutoProvisioningStatus();

  return resolveAccountBootstrapPhase({
    autoGenerateIdentity: features.autoGenerateIdentity,
    autoProvisioningEnabled: autoProvisioning.enabled,
    autoRegisterIdentity: features.autoRegisterIdentity,
    databaseFailed: databaseStatus === "error",
    generation: autoProvisioning.generation.status,
    hasSigningKey: identity.signingKeyPair !== null,
    identityDestroyed: identity.identityDestroyed,
    identityRestored:
      identity.signingFingerprint !== null &&
      identity.localIdentityRestoredFingerprint === identity.signingFingerprint,
    identityTransitionInFlight: identity.identityTransitionInFlight,
    isAuthenticated: session.isAuthenticated,
    isLocked,
    localIdentityRestoreSettled: identity.localIdentityRestoreSettled,
    registration: autoProvisioning.registration.status,
    sessionRestoreSettled: session.sessionRestoreSettled,
    systemBootstrapStatus,
    userId: session.userId,
  });
}

/** Progress copy while the account is bootstrapping, or null once it is not. */
export function useAccountBootstrapProgress(): AccountBootstrapCopy | null {
  return accountBootstrapCopy(useAccountBootstrapPhase());
}

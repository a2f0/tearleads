import { useCallback } from "react";
import {
  selfPaneLabel,
  usePaneSideOptional,
} from "../components/pane/dual-pane";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../providers/db/DatabaseProvider";
import { useAppHostConfig } from "../providers/host/AppHostConfigProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useSymCrypt } from "../providers/sdk/SymCryptProvider";

export interface RegisterCurrentIdentityResult {
  canRegisterCurrentIdentity: boolean;
  registerCurrentIdentity: () => Promise<boolean>;
}

export function useRegisterCurrentIdentity(): RegisterCurrentIdentityResult {
  const { client: dbClient } = useDatabase();
  const { userId, containerId, loginWithChallenge } = useCryptoSession();
  const { encapsulationKeyPair, signingKeyPair } = useIdentity();
  const symcrypt = useSymCrypt();
  // Demo-only: name each pane's bootstrapped personal org after its peer label
  // ("Peer 1's Org"). usePaneSideOptional stays null in the regular app (whose
  // runtime mounts outside any PaneSideProvider), so the name is left undefined
  // and the SDK keeps the neutral "Personal Org" default.
  const { seedPeerIdentities } = useAppHostConfig().profile.features;
  const paneSide = usePaneSideOptional();
  const organizationProfileName =
    seedPeerIdentities && paneSide
      ? `${selfPaneLabel(paneSide)}'s Org`
      : undefined;
  // Demo-only: label this pane's own roster entry "Peer 1 (You)" instead of the
  // neutral "You" default, matching the peer-labeled self contact.
  const rosterProfileNickname =
    seedPeerIdentities && paneSide
      ? `${selfPaneLabel(paneSide)} (You)`
      : undefined;

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

    const response = await symcrypt.session.registerIdentity({
      organizationProfileName,
      rosterProfileNickname,
    });
    if (!response) {
      return false;
    }

    return loginWithChallenge(response.challenge);
  }, [
    canRegisterCurrentIdentity,
    loginWithChallenge,
    organizationProfileName,
    rosterProfileNickname,
    symcrypt,
  ]);

  return { canRegisterCurrentIdentity, registerCurrentIdentity };
}

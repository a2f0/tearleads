import { useCallback } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../providers/db/DatabaseProvider";
import { useAppHostConfig } from "../providers/host/AppHostConfigProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useTearleads } from "../providers/sdk/TearleadsProvider";
import { selfPaneLabel, usePaneSideOptional } from "../shell/pane/dual-pane";
import { personalOrganizationName } from "./accountNamingMachine";
import { useAutoProvisioningStatus } from "./autoProvisioningStatus";
import { RegistrationRecoveryError } from "./registrationRecoveryError";

export interface RegisterCurrentIdentityOptions {
  /**
   * What the user asked to be called: names the personal org `<name>'s Org`
   * and the account's own roster entry. Defaults to the name the user gave the
   * autopilot, if any, else the SDK's "Personal Org" and "You".
   */
  readonly accountName?: string | undefined;
}

export interface RegisterCurrentIdentityResult {
  canRegisterCurrentIdentity: boolean;
  registerCurrentIdentity: (
    options?: RegisterCurrentIdentityOptions,
  ) => Promise<boolean>;
}

interface RegistrationNames {
  readonly organizationProfileName?: string | undefined;
  readonly rosterProfileNickname?: string | undefined;
}

/**
 * The personal org's and own roster entry's names a registration seeds: a
 * demo pane's peer label, else what the user asked to be called, else the
 * SDK's defaults ("Personal Org", "You").
 */
function registrationNames(
  peerLabel: string | null,
  accountName: string | undefined,
): RegistrationNames {
  if (peerLabel) {
    return {
      organizationProfileName: `${peerLabel}'s Org`,
      rosterProfileNickname: `${peerLabel} (You)`,
    };
  }
  return accountName
    ? {
        organizationProfileName: personalOrganizationName(accountName),
        rosterProfileNickname: accountName,
      }
    : {};
}

export function useRegisterCurrentIdentity(): RegisterCurrentIdentityResult {
  const { client: dbClient } = useDatabase();
  const { userId, containerId, login, loginWithChallenge } = useCryptoSession();
  const { encapsulationKeyPair, signingKeyPair } = useIdentity();
  const tearleads = useTearleads();
  // Demo-only: name each pane's bootstrapped personal org after its peer label
  // ("Peer 1's Org") and its own roster entry "Peer 1 (You)", matching the
  // peer-labeled self contact. usePaneSideOptional stays null in the regular
  // app (whose runtime mounts outside any PaneSideProvider). There a manual
  // Register (say, after an offline first launch) keeps the name the user
  // already gave; the autopilot, which provides that name, passes it
  // explicitly.
  const { seedPeerIdentities } = useAppHostConfig().profile.features;
  const paneSide = usePaneSideOptional();
  const peerLabel =
    seedPeerIdentities && paneSide ? selfPaneLabel(paneSide) : null;
  const { accountNaming } = useAutoProvisioningStatus();
  const givenName =
    accountNaming.status === "named" ? accountNaming.name : undefined;

  const canRegisterCurrentIdentity =
    signingKeyPair !== null &&
    encapsulationKeyPair !== null &&
    userId === null &&
    containerId !== null &&
    dbClient !== null;

  const registerCurrentIdentity = useCallback(
    async (options?: RegisterCurrentIdentityOptions): Promise<boolean> => {
      if (!canRegisterCurrentIdentity) {
        return false;
      }

      const identitySnapshot = tearleads.identity.snapshot;
      const response = await tearleads.session.registerIdentity(
        registrationNames(peerLabel, options?.accountName ?? givenName),
      );
      if (tearleads.identity.snapshot !== identitySnapshot) {
        return false;
      }
      if (!response || "status" in response) {
        // Both a lost registration response and a known binding recover through
        // proof of key ownership. Neither permits publishing a replaced identity.
        const recovered = await login();
        if (tearleads.identity.snapshot !== identitySnapshot) return false;
        if (response && !recovered) {
          throw new RegistrationRecoveryError(tearleads.network.online);
        }
        return recovered;
      }

      return loginWithChallenge(response.challenge);
    },
    [
      canRegisterCurrentIdentity,
      givenName,
      login,
      loginWithChallenge,
      peerLabel,
      tearleads,
    ],
  );

  return { canRegisterCurrentIdentity, registerCurrentIdentity };
}

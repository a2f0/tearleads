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
   * Names the personal org. Defaults to the name the user gave the autopilot,
   * if any, else the SDK's "Personal Org".
   */
  readonly organizationProfileName?: string | undefined;
}

export interface RegisterCurrentIdentityResult {
  canRegisterCurrentIdentity: boolean;
  registerCurrentIdentity: (
    options?: RegisterCurrentIdentityOptions,
  ) => Promise<boolean>;
}

export function useRegisterCurrentIdentity(): RegisterCurrentIdentityResult {
  const { client: dbClient } = useDatabase();
  const { userId, containerId, login, loginWithChallenge } = useCryptoSession();
  const { encapsulationKeyPair, signingKeyPair } = useIdentity();
  const tearleads = useTearleads();
  // Demo-only: name each pane's bootstrapped personal org after its peer label
  // ("Peer 1's Org"). usePaneSideOptional stays null in the regular app (whose
  // runtime mounts outside any PaneSideProvider). There a manual Register (say,
  // after an offline first launch) keeps the name the user already gave; the
  // autopilot, which provides that name, passes it explicitly.
  const { seedPeerIdentities } = useAppHostConfig().profile.features;
  const paneSide = usePaneSideOptional();
  const { accountNaming } = useAutoProvisioningStatus();
  const defaultOrganizationName =
    seedPeerIdentities && paneSide
      ? `${selfPaneLabel(paneSide)}'s Org`
      : accountNaming.status === "named"
        ? personalOrganizationName(accountNaming.name)
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

  const registerCurrentIdentity = useCallback(
    async (options?: RegisterCurrentIdentityOptions): Promise<boolean> => {
      if (!canRegisterCurrentIdentity) {
        return false;
      }

      const identitySnapshot = tearleads.identity.snapshot;
      const response = await tearleads.session.registerIdentity({
        organizationProfileName:
          options?.organizationProfileName ?? defaultOrganizationName,
        rosterProfileNickname,
      });
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
      defaultOrganizationName,
      login,
      loginWithChallenge,
      rosterProfileNickname,
      tearleads,
    ],
  );

  return { canRegisterCurrentIdentity, registerCurrentIdentity };
}

import type { Tearleads } from "@tearleads/client-sdk";
import { useCallback } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../providers/db/DatabaseProvider";
import { useAppHostConfig } from "../providers/host/AppHostConfigProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useTearleads } from "../providers/sdk/TearleadsProvider";
import { selfPaneLabel, usePaneSideOptional } from "../shell/pane/dual-pane";
import { personalOrganizationName } from "./accountNamingMachine";
import { useAutoProvisioningStatus } from "./autoProvisioningStatus";
import {
  useLegalTermsAgreement,
  useLegalTermsAgreementStore,
} from "./legalTermsAgreement";
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
  /**
   * The current identity could register now; a new account also needs the
   * legal terms agreed ({@link RegisterCurrentIdentityResult.legalTermsRequired}).
   */
  canRegisterCurrentIdentity: boolean;
  /**
   * Registration records the agreement, so the person is asked first. An
   * identity this device already binds to an account signs back in instead.
   */
  legalTermsRequired: boolean;
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

type RegistrationResponse = Awaited<
  ReturnType<Tearleads["session"]["registerIdentity"]>
>;

/**
 * Registers carrying the agreed revision, read when it starts so one that
 * follows the agreement at once carries it. Without one, only a key this
 * device already binds to an account goes on, declined as registration would
 * decline it, to sign back in; any other waits for the agreement.
 */
async function registerWithAgreement(
  session: Tearleads["session"],
  agreedVersion: string | null,
  names: RegistrationNames,
): Promise<RegistrationResponse | "awaiting-agreement"> {
  if (agreedVersion !== null) {
    return session.registerIdentity({
      acceptedLegalTermsVersion: agreedVersion,
      ...names,
    });
  }
  const userId = await session.boundUserId();
  return userId === null
    ? "awaiting-agreement"
    : { status: "identity-already-bound", userId };
}

/**
 * Both a lost registration response and a known binding recover through
 * proof of key ownership. Neither permits publishing a replaced identity. A
 * declined key that cannot sign back in says why.
 */
async function signBackIn(
  tearleads: Tearleads,
  login: () => Promise<boolean>,
  identitySnapshot: Tearleads["identity"]["snapshot"],
  declined: boolean,
): Promise<boolean> {
  const recovered = await login();
  if (tearleads.identity.snapshot !== identitySnapshot) return false;
  if (declined && !recovered) {
    throw new RegistrationRecoveryError(tearleads.network.online);
  }
  return recovered;
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
  const { accountNaming, legalTerms: legalTermsRequirement } =
    useAutoProvisioningStatus();
  const { agreedVersion } = useLegalTermsAgreement();
  const legalTerms = useLegalTermsAgreementStore();
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
      if (!canRegisterCurrentIdentity) return false;

      const identitySnapshot = tearleads.identity.snapshot;
      const response = await registerWithAgreement(
        tearleads.session,
        legalTerms.agreedVersion,
        registrationNames(peerLabel, options?.accountName ?? givenName),
      );
      if (tearleads.identity.snapshot !== identitySnapshot) return false;
      if (response === "awaiting-agreement") {
        // Without an agreement only an identity with an account goes on: one
        // recovered from its passphrase has one this device does not bind yet.
        return legalTermsRequirement === "not-required"
          ? signBackIn(tearleads, login, identitySnapshot, false)
          : false;
      }
      if (!response || "status" in response) {
        return signBackIn(
          tearleads,
          login,
          identitySnapshot,
          response !== null,
        );
      }

      return loginWithChallenge(response.challenge);
    },
    [
      canRegisterCurrentIdentity,
      givenName,
      legalTerms,
      legalTermsRequirement,
      login,
      loginWithChallenge,
      peerLabel,
      tearleads,
    ],
  );

  return {
    canRegisterCurrentIdentity,
    // The autopilot reads whether the device binds this key; without one
    // (outside a runtime), a registration asks.
    legalTermsRequired:
      agreedVersion === null && legalTermsRequirement !== "not-required",
    registerCurrentIdentity,
  };
}

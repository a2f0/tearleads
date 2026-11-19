import type { SystemBootstrapStatus } from "../providers/system-bootstrap/systemBootstrapMachine";
import type { AutoProvisioningStep } from "./autoProvisioningStatus";
import type { IdentityOnboardingState } from "./identityOnboardingMachine";

/**
 * Where the current account stands on its way to a signed-in session.
 *
 * - `signed-in`: authenticated.
 * - `restoring-session`: a stored identity or session is still loading.
 * - `creating-identity`: the autopilot is deriving a new identity key pair.
 * - `choosing-identity`: a fresh device offers creation or recovery.
 * - `naming-account`: creation or a previously pending registration awaits a name.
 * - `entering-passphrase`: the user can paste their recovery passphrase.
 * - `restoring-identity`: the app is importing the recovered keys.
 * - `creating-account`: the autopilot is registering a new identity.
 * - `signing-in`: the autopilot is logging a restored identity back in.
 * - `signed-out`: nothing is in flight; the user has to act.
 */
export type AccountBootstrapPhase =
  | "signed-in"
  | "restoring-session"
  | IdentityOnboardingState["status"]
  | "creating-account"
  | "signing-in"
  | "signed-out";

export interface AccountBootstrapInput {
  readonly onboardingPhase?: IdentityOnboardingState["status"] | undefined;
  /** The autopilot holds this identity's registration for the user's name. */
  readonly awaitingAccountName: boolean;
  readonly autoGenerateIdentity: boolean;
  readonly autoProvisioningEnabled: boolean;
  readonly autoRegisterIdentity: boolean;
  /** "error" once the local database gave up booting (retries exhausted). */
  readonly databaseFailed: boolean;
  readonly generation: AutoProvisioningStep["status"];
  readonly hasSigningKey: boolean;
  readonly identityDestroyed: boolean;
  readonly identityRestored: boolean;
  readonly identityTransitionInFlight: boolean;
  readonly isAuthenticated: boolean;
  readonly isLocked: boolean;
  readonly localIdentityRestoreSettled: boolean;
  readonly registration: AutoProvisioningStep["status"];
  readonly sessionRestoreSettled: boolean;
  readonly systemBootstrapStatus: SystemBootstrapStatus;
  /** Set once this identity has signed in on this device, even if now signed out. */
  readonly userId: string | null;
}

/**
 * Pure derivation so every surface reads the same answer. A provisioning
 * phase is only reported while something will actually advance it: the
 * autopilot is armed for this runtime, has not failed, and the user has not
 * opted out (a destroyed key pair, or an explicit log out, which keeps the
 * user id and so stops the autopilot from re-registering).
 */
export function resolveAccountBootstrapPhase(
  input: AccountBootstrapInput,
): AccountBootstrapPhase {
  if (input.isAuthenticated) {
    return "signed-in";
  }
  // The keyring lock screen owns this state; signed-out surfaces stay passive.
  // A database that gave up booting stalls every later step (bootstrap waits
  // on it, so registration never starts), so nothing is in flight either.
  if (input.isLocked || input.databaseFailed) {
    return "signed-out";
  }
  if (input.onboardingPhase) return input.onboardingPhase;
  if (input.identityTransitionInFlight || !input.localIdentityRestoreSettled) {
    return "restoring-session";
  }
  // Keys become visible before generation finishes storing the identity.
  if (input.autoProvisioningEnabled && input.generation === "running") {
    return "creating-identity";
  }
  if (!input.hasSigningKey) {
    return input.autoProvisioningEnabled &&
      input.autoGenerateIdentity &&
      input.generation !== "failed" &&
      !input.identityDestroyed
      ? "creating-identity"
      : "signed-out";
  }
  if (!input.sessionRestoreSettled) {
    return "restoring-session";
  }
  return registrationPhase(input);
}

/** The phase once the signing key and the session restore have settled. */
function registrationPhase(
  input: AccountBootstrapInput,
): AccountBootstrapPhase {
  const autoRegistering =
    input.autoProvisioningEnabled && input.autoRegisterIdentity;
  // Registration stores the user id before its login lands, so an in-flight
  // run outranks the user-id check below.
  if (autoRegistering && input.registration === "running") {
    return input.identityRestored ? "signing-in" : "creating-account";
  }
  if (!autoRegistering || input.userId !== null) {
    return "signed-out";
  }
  // Registration holds until the name is given, whatever an earlier run (say,
  // for another identity before a switch back) or bootstrap reported.
  if (input.awaitingAccountName) {
    return "naming-account";
  }
  if (
    input.registration === "failed" ||
    input.systemBootstrapStatus === "error"
  ) {
    return "signed-out";
  }
  return input.identityRestored ? "signing-in" : "creating-account";
}

type AccountBootstrapProgressPhase = Exclude<
  AccountBootstrapPhase,
  "signed-in" | "signed-out"
>;

export interface AccountBootstrapCopy {
  readonly description: string;
  readonly phase: AccountBootstrapProgressPhase;
  readonly title: string;
}

const ACCOUNT_BOOTSTRAP_COPY: {
  readonly [Phase in AccountBootstrapProgressPhase]: AccountBootstrapCopy & {
    readonly phase: Phase;
  };
} = {
  "choosing-identity": {
    title: "Set up your identity",
    description:
      "Create an identity or restore one with your recovery passphrase.",
    phase: "choosing-identity",
  },
  "entering-passphrase": {
    title: "Restore your identity",
    description:
      "Paste your recovery passphrase to use this identity on this device.",
    phase: "entering-passphrase",
  },
  "restoring-identity": {
    title: "Restoring your identity",
    description: "Recovering your keys from your passphrase.",
    phase: "restoring-identity",
  },
  "creating-account": {
    description:
      "Registering your identity and setting up your personal organization.",
    phase: "creating-account",
    title: "Creating your account",
  },
  "creating-identity": {
    description:
      "Generating the keys that identify you. This happens once per device.",
    phase: "creating-identity",
    title: "Creating your identity",
  },
  "naming-account": {
    description:
      "This is encrypted and only visible to members you add to your organization.",
    phase: "naming-account",
    title: "What should we call you?",
  },
  "restoring-session": {
    description: "Loading your identity and session from this device.",
    phase: "restoring-session",
    title: "Restoring your session",
  },
  "signing-in": {
    description: "Proving ownership of your identity to the server.",
    phase: "signing-in",
    title: "Signing you in",
  },
};

/** Progress copy for a bootstrapping phase, or null once nothing is in flight. */
export function accountBootstrapCopy(
  phase: AccountBootstrapPhase,
): AccountBootstrapCopy | null {
  return phase === "signed-in" || phase === "signed-out"
    ? null
    : ACCOUNT_BOOTSTRAP_COPY[phase];
}

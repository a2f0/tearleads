import type { SystemBootstrapStatus } from "../providers/system-bootstrap/systemBootstrapMachine";
import type { AutoProvisioningStep } from "./autoProvisioningStatus";

/**
 * Where the current account stands on its way to a signed-in session.
 *
 * - `signed-in`: authenticated.
 * - `restoring-session`: a stored identity or session is still loading.
 * - `creating-identity`: the autopilot is deriving a new identity key pair.
 * - `creating-account`: the autopilot is registering a new identity.
 * - `signing-in`: the autopilot is logging a restored identity back in.
 * - `signed-out`: nothing is in flight; the user has to act.
 */
export type AccountBootstrapPhase =
  | "signed-in"
  | "restoring-session"
  | "creating-identity"
  | "creating-account"
  | "signing-in"
  | "signed-out";

export interface AccountBootstrapInput {
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
  if (input.identityTransitionInFlight || !input.localIdentityRestoreSettled) {
    return "restoring-session";
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
  const autoRegistering =
    input.autoProvisioningEnabled && input.autoRegisterIdentity;
  // Registration stores the user id before its login lands, so an in-flight
  // run outranks the user-id check below.
  if (autoRegistering && input.registration === "running") {
    return input.identityRestored ? "signing-in" : "creating-account";
  }
  if (
    !autoRegistering ||
    input.userId !== null ||
    input.registration === "failed" ||
    input.systemBootstrapStatus === "error"
  ) {
    return "signed-out";
  }
  return input.identityRestored ? "signing-in" : "creating-account";
}

export interface AccountBootstrapCopy {
  readonly title: string;
  readonly description: string;
}

const ACCOUNT_BOOTSTRAP_COPY: Record<
  Exclude<AccountBootstrapPhase, "signed-in" | "signed-out">,
  AccountBootstrapCopy
> = {
  "creating-account": {
    description:
      "Registering your identity and setting up your personal organization.",
    title: "Creating your account",
  },
  "creating-identity": {
    description:
      "Generating the keys that identify you. This happens once per device.",
    title: "Creating your identity",
  },
  "restoring-session": {
    description: "Loading your identity and session from this device.",
    title: "Restoring your session",
  },
  "signing-in": {
    description: "Proving ownership of your identity to the server.",
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

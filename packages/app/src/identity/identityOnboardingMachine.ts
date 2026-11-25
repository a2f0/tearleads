export type OnboardingForm = "naming-account" | "entering-passphrase";

/**
 * `accepting-terms` comes before naming a new identity, unless the person
 * already agreed on this page: they read the Privacy Policy and Terms of
 * Service and agree to them, as its registration will record. A restored
 * identity is already registered, so restoring never asks.
 *
 * `confirming-backup` follows a created identity: the user backs up its new
 * recovery key and types an agreement before the account is registered. A
 * restored identity skips it, since its passphrase is the backup.
 */
export type IdentityOnboardingState =
  | { readonly status: "choosing-identity" }
  | { readonly status: "accepting-terms" }
  | { readonly status: OnboardingForm; readonly error?: string }
  | {
      readonly status: "creating-identity" | "restoring-identity";
      readonly request: symbol;
    }
  | { readonly status: "confirming-backup" };

export type OnboardingNavigation =
  | OnboardingForm
  | "accepting-terms"
  | "choosing-identity";

export type OnboardingEvent =
  | { type: "navigate"; phase: OnboardingNavigation }
  | { type: "terms-agreed" }
  | { type: "submit"; form: OnboardingForm; request: symbol }
  | { type: "finish"; request: symbol; error?: string }
  | { type: "confirm-backup" };

export const INITIAL_ONBOARDING = { status: "choosing-identity" } as const;

const CONFIRMING_BACKUP = { status: "confirming-backup" } as const;

const operationFor = {
  "naming-account": "creating-identity",
  "entering-passphrase": "restoring-identity",
} as const;

const retryForm = {
  "creating-identity": "naming-account",
  "restoring-identity": "entering-passphrase",
} as const;

const settledState = {
  "creating-identity": CONFIRMING_BACKUP,
  "restoring-identity": INITIAL_ONBOARDING,
} as const;

/** Moves between the choice and its forms; nothing leaves work or a backup. */
function navigateOnboarding(
  state: IdentityOnboardingState,
  phase: OnboardingNavigation,
): IdentityOnboardingState {
  if ("request" in state || state.status === "confirming-backup") {
    return state;
  }
  return state.status === "choosing-identity" || phase === "choosing-identity"
    ? { status: phase }
    : state;
}

export function transitionIdentityOnboarding(
  state: IdentityOnboardingState,
  event: OnboardingEvent,
): IdentityOnboardingState {
  switch (event.type) {
    case "navigate":
      return navigateOnboarding(state, event.phase);
    case "submit":
      return state.status === event.form
        ? {
            status: operationFor[event.form],
            request: event.request,
          }
        : state;
    case "finish":
      if (!("request" in state) || state.request !== event.request)
        return state;
      return event.error
        ? {
            status: retryForm[state.status],
            error: event.error,
          }
        : settledState[state.status];
    case "terms-agreed":
      return state.status === "accepting-terms"
        ? { status: "naming-account" }
        : state;
    case "confirm-backup":
      return state.status === "confirming-backup" ? INITIAL_ONBOARDING : state;
  }
}

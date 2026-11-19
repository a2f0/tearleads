export type OnboardingForm = "naming-account" | "entering-passphrase";

export type IdentityOnboardingState =
  | { readonly status: "choosing-identity" }
  | { readonly status: OnboardingForm; readonly error?: string }
  | {
      readonly status: "creating-identity" | "restoring-identity";
      readonly request: symbol;
    };

export type OnboardingNavigation = OnboardingForm | "choosing-identity";

export type OnboardingEvent =
  | { type: "navigate"; phase: OnboardingNavigation }
  | { type: "submit"; form: OnboardingForm; request: symbol }
  | { type: "finish"; request: symbol; error?: string };

export const INITIAL_ONBOARDING = { status: "choosing-identity" } as const;

const operationFor = {
  "naming-account": "creating-identity",
  "entering-passphrase": "restoring-identity",
} as const;

const retryForm = {
  "creating-identity": "naming-account",
  "restoring-identity": "entering-passphrase",
} as const;

export function transitionIdentityOnboarding(
  state: IdentityOnboardingState,
  event: OnboardingEvent,
): IdentityOnboardingState {
  switch (event.type) {
    case "navigate":
      if ("request" in state) return state;
      return state.status === "choosing-identity" ||
        event.phase === "choosing-identity"
        ? { status: event.phase }
        : state;
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
        : INITIAL_ONBOARDING;
  }
}

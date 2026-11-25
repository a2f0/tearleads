import type { TwoFactorSetup, TwoFactorStatus } from "@tearleads/client-sdk";

/** Organizations refusing this session until it passes a second factor. */
type RequiredBy = { readonly requiredByOrganizationIds: readonly string[] };

/**
 * The Two-Factor panel. Codes are shown once, after turning two-factor on or
 * replacing them, until the person confirms they saved them.
 */
export type TwoFactorPanelState =
  | { readonly status: "loading" }
  | { readonly message: string; readonly status: "failed" }
  | (RequiredBy & { readonly status: "off" })
  | (RequiredBy & {
      readonly setup: TwoFactorSetup;
      readonly status: "setting-up";
    })
  | {
      readonly recoveryCodes: readonly string[];
      readonly status: "showing-codes";
    }
  | { readonly current: TwoFactorStatus; readonly status: "on" };

export type TwoFactorPanelEvent =
  | { readonly type: "load" }
  | { readonly message: string; readonly type: "failed" }
  | { readonly current: TwoFactorStatus; readonly type: "loaded" }
  | { readonly setup: TwoFactorSetup; readonly type: "setup-started" }
  | { readonly type: "setup-cancelled" }
  | {
      readonly recoveryCodes: readonly string[];
      readonly type: "codes-issued";
    }
  | { readonly type: "disabled" };

export const INITIAL_TWO_FACTOR_PANEL_STATE: TwoFactorPanelState = {
  status: "loading",
};

export function transitionTwoFactorPanel(
  state: TwoFactorPanelState,
  event: TwoFactorPanelEvent,
): TwoFactorPanelState {
  switch (event.type) {
    case "load":
      return { status: "loading" };
    case "failed":
      return state.status === "loading"
        ? { message: event.message, status: "failed" }
        : state;
    case "loaded":
      return event.current.enabled
        ? { current: event.current, status: "on" }
        : {
            requiredByOrganizationIds: event.current.requiredByOrganizationIds,
            status: "off",
          };
    case "setup-started":
      return state.status === "off" || state.status === "setting-up"
        ? {
            requiredByOrganizationIds: state.requiredByOrganizationIds,
            setup: event.setup,
            status: "setting-up",
          }
        : state;
    case "setup-cancelled":
      return state.status === "setting-up"
        ? {
            requiredByOrganizationIds: state.requiredByOrganizationIds,
            status: "off",
          }
        : state;
    case "codes-issued":
      return { recoveryCodes: event.recoveryCodes, status: "showing-codes" };
    case "disabled":
      // Turning off signs this session out; its renewal reports afresh.
      return { requiredByOrganizationIds: [], status: "off" };
  }
}

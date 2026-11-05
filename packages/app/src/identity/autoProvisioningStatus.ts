import { createContext, useContext } from "react";

/**
 * Where the identity autopilot's automatic register-and-login stands. "failed"
 * carries the reason so a signed-out surface can say why instead of leaving
 * the user with a bare Login button.
 */
export type AutoRegistrationState =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "failed"; readonly message: string };

export interface AutoProvisioningStatus {
  /** Whether this runtime's autopilot may provision (its workspace is active). */
  readonly enabled: boolean;
  readonly registration: AutoRegistrationState;
}

export const AUTO_REGISTRATION_IDLE: AutoRegistrationState = { status: "idle" };

/**
 * The default reads as "no autopilot": surfaces rendered outside a runtime (and
 * component tests) keep showing the plain signed-out state.
 */
export const AutoProvisioningStatusContext =
  createContext<AutoProvisioningStatus>({
    enabled: false,
    registration: AUTO_REGISTRATION_IDLE,
  });

export function useAutoProvisioningStatus(): AutoProvisioningStatus {
  return useContext(AutoProvisioningStatusContext);
}

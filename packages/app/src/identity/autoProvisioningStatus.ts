import { createContext, useContext } from "react";

/**
 * Where one automatic provisioning step (key generation, or register-and-login)
 * stands. "failed" carries the reason so a signed-out surface can say why
 * instead of leaving the user with a bare Login button.
 */
export type AutoProvisioningStep =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "failed"; readonly message: string };

export interface AutoProvisioningStatus {
  /** Whether this runtime's autopilot may provision (its workspace is active). */
  readonly enabled: boolean;
  readonly generation: AutoProvisioningStep;
  readonly registration: AutoProvisioningStep;
}

export const AUTO_PROVISIONING_IDLE: AutoProvisioningStep = { status: "idle" };

/**
 * The default reads as "no autopilot": surfaces rendered outside a runtime (and
 * component tests) keep showing the plain signed-out state.
 */
export const AutoProvisioningStatusContext =
  createContext<AutoProvisioningStatus>({
    enabled: false,
    generation: AUTO_PROVISIONING_IDLE,
    registration: AUTO_PROVISIONING_IDLE,
  });

export function useAutoProvisioningStatus(): AutoProvisioningStatus {
  return useContext(AutoProvisioningStatusContext);
}

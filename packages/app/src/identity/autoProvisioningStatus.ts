import { createContext, useContext } from "react";
import {
  ACCOUNT_NAMING_IDLE,
  type AccountNamingState,
} from "./accountNamingMachine";

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
  /** Naming of the current identity's first registration. */
  readonly accountNaming: AccountNamingState;
  /**
   * Whether the current identity's sealed naming has been read back. Until
   * then a name it still owes may yet hold registration and the apps.
   */
  readonly accountNamingSettled: boolean;
  /** Whether this runtime's autopilot may provision (its workspace is active). */
  readonly enabled: boolean;
  readonly generation: AutoProvisioningStep;
  readonly registration: AutoProvisioningStep;
  /** Names the current identity's account; ignored unless it awaits a name. */
  readonly submitAccountName: (name: string) => void;
}

export const AUTO_PROVISIONING_IDLE: AutoProvisioningStep = { status: "idle" };

/**
 * The default reads as "no autopilot": surfaces rendered outside a runtime (and
 * component tests) keep showing the plain signed-out state.
 */
export const AutoProvisioningStatusContext =
  createContext<AutoProvisioningStatus>({
    accountNaming: ACCOUNT_NAMING_IDLE,
    accountNamingSettled: true,
    enabled: false,
    generation: AUTO_PROVISIONING_IDLE,
    registration: AUTO_PROVISIONING_IDLE,
    // Nothing outside a runtime awaits a name, so there is nothing to submit.
    submitAccountName: () => {},
  });

export function useAutoProvisioningStatus(): AutoProvisioningStatus {
  return useContext(AutoProvisioningStatusContext);
}

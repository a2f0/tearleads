/**
 * Whether the page may render the app: not while it wipes for a reset, and not
 * after it reloaded because another page reset the device.
 */
export type DeviceResetGateState =
  | { readonly status: "ready" }
  | { readonly status: "resetting" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "reset-elsewhere" };

export type DeviceResetGateEvent =
  | { readonly type: "reset-completed" }
  | { readonly type: "reset-failed"; readonly message: string };

// Only a running reset settles. Leaving a failure (retry) or the notice of a
// reset made elsewhere reloads the page instead of transitioning, as does
// another page's reset reaching a ready one.
export function transitionDeviceResetGate(
  state: DeviceResetGateState,
  event: DeviceResetGateEvent,
): DeviceResetGateState {
  if (state.status !== "resetting") {
    return state;
  }
  return event.type === "reset-completed"
    ? { status: "ready" }
    : { message: event.message, status: "failed" };
}

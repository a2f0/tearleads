/**
 * Whether the page may render the app: not while it wipes for a reset, and no
 * longer once another tab has reset the device out from under it.
 */
export type DeviceResetGateState =
  | { readonly status: "ready" }
  | { readonly status: "resetting" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "reset-elsewhere" };

export type DeviceResetGateEvent =
  | { readonly type: "reset-completed" }
  | { readonly type: "reset-failed"; readonly message: string }
  | { readonly type: "reset-requested-elsewhere" };

// Leaving a failure (retry) or a reset made elsewhere reloads the page instead
// of transitioning.
export function transitionDeviceResetGate(
  state: DeviceResetGateState,
  event: DeviceResetGateEvent,
): DeviceResetGateState {
  switch (event.type) {
    case "reset-completed":
      return state.status === "resetting" ? { status: "ready" } : state;
    case "reset-failed":
      return state.status === "resetting"
        ? { message: event.message, status: "failed" }
        : state;
    case "reset-requested-elsewhere":
      return state.status === "ready" ? { status: "reset-elsewhere" } : state;
  }
}

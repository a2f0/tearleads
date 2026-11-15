/**
 * Whether the page may render the app. It waits for the app-pages lock before
 * mounting it ("joining"), holds it back while it wipes for a reset, and stops
 * at a notice when another page reset or is resetting the device.
 */
export type DeviceResetGateState =
  | { readonly status: "joining" }
  | { readonly status: "ready" }
  | { readonly status: "resetting" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "reset-elsewhere" };

export type DeviceResetGateEvent =
  | { readonly type: "page-lock-held"; readonly resetRequested: boolean }
  | { readonly type: "reset-completed" }
  | { readonly type: "reset-failed"; readonly message: string };

// Leaving a failure (retry) or the notice of a reset made elsewhere reloads
// the page instead of transitioning, as does another page's reset reaching a
// ready one.
export function transitionDeviceResetGate(
  state: DeviceResetGateState,
  event: DeviceResetGateEvent,
): DeviceResetGateState {
  switch (event.type) {
    case "page-lock-held":
      if (state.status !== "joining") {
        return state;
      }
      // A reset was requested while this page waited, and its wipe now waits
      // for this page; mounting the app here would write under it.
      return event.resetRequested
        ? { status: "reset-elsewhere" }
        : { status: "ready" };
    case "reset-completed":
      // The wiped device is joined like any other page.
      return state.status === "resetting" ? { status: "joining" } : state;
    case "reset-failed":
      return state.status === "resetting"
        ? { message: event.message, status: "failed" }
        : state;
  }
}

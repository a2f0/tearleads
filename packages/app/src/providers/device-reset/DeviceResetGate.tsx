import { type PropsWithChildren, useEffect, useReducer } from "react";
import "../../components/mini-app/controls/MiniAppStatus.css";
import {
  isDeviceResetRequested,
  runRequestedDeviceReset,
  subscribeDeviceResetRequests,
} from "./deviceReset";
import {
  type DeviceResetGateState,
  transitionDeviceResetGate,
} from "./deviceResetGateState";

interface DeviceResetGateProps extends PropsWithChildren {
  /** Performs the requested reset; tests substitute the page's storage. */
  readonly completeReset?: () => Promise<void>;
}

/**
 * Holds the app back while a requested device reset wipes this device, so
 * nothing opens storage that is about to be removed. Without a request it
 * renders the app on the first render. When another tab resets the device it
 * unmounts the app, so this page neither holds the old data open nor writes
 * it back, and offers a reload.
 */
export function DeviceResetGate({
  children,
  completeReset = runRequestedDeviceReset,
}: DeviceResetGateProps) {
  const [state, dispatch] = useReducer(
    transitionDeviceResetGate,
    undefined,
    (): DeviceResetGateState =>
      isDeviceResetRequested() ? { status: "resetting" } : { status: "ready" },
  );

  useEffect(() => {
    if (state.status !== "resetting") {
      return;
    }
    let current = true;
    void completeReset().then(
      () => {
        if (current) dispatch({ type: "reset-completed" });
      },
      (error: unknown) => {
        if (current) {
          dispatch({
            message: error instanceof Error ? error.message : String(error),
            type: "reset-failed",
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [completeReset, state.status]);

  useEffect(
    () =>
      state.status === "ready"
        ? subscribeDeviceResetRequests(() =>
            dispatch({ type: "reset-requested-elsewhere" }),
          )
        : undefined,
    [state.status],
  );

  if (state.status === "ready") {
    return children;
  }
  if (state.status === "resetting") {
    return (
      <div role="status" className="mini-app-status">
        <p>Resetting this device…</p>
      </div>
    );
  }
  if (state.status === "reset-elsewhere") {
    return (
      <div role="status" className="mini-app-status">
        <p>This device was reset in another tab or window.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
  // No way into the app from here: part of the device may already be wiped,
  // so the reset has to finish before anything boots on it.
  return (
    <div role="alert" className="mini-app-status">
      <p>This device could not be reset: {state.message}</p>
      <p>
        Another tab or window may still be using its data. Close it, then try
        again.
      </p>
      <button type="button" onClick={() => window.location.reload()}>
        Try again
      </button>
    </div>
  );
}

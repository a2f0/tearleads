import { type PropsWithChildren, useEffect, useReducer } from "react";
import "../../components/mini-app/controls/MiniAppStatus.css";
import { isDeviceResetRequested, runRequestedDeviceReset } from "./deviceReset";
import {
  type DeviceResetGateState,
  transitionDeviceResetGate,
} from "./deviceResetGateState";
import {
  holdAppPageLock,
  reloadOnDeviceResetElsewhere,
  wasResetElsewhere,
} from "./deviceResetTabs";

type ClearNativeCache = () => Promise<void>;

interface DeviceResetGateProps extends PropsWithChildren {
  /** The host's cleanup of files it staged outside WebView storage. */
  readonly clearNativeCache?: ClearNativeCache | undefined;
  /** Performs the requested reset; tests substitute the page's storage. */
  readonly completeReset?: (
    clearNativeCache: ClearNativeCache | undefined,
  ) => Promise<void>;
}

/**
 * Holds the app back while a requested device reset wipes this device, so
 * nothing opens storage that is about to be removed. Without a request it
 * renders the app on the first render. While the app is mounted the page holds
 * the app-pages lock a wipe waits on, and reloads when another page resets the
 * device, coming back to a notice instead of the app.
 */
export function DeviceResetGate({
  children,
  clearNativeCache,
  completeReset = runRequestedDeviceReset,
}: DeviceResetGateProps) {
  const [state, dispatch] = useReducer(
    transitionDeviceResetGate,
    undefined,
    (): DeviceResetGateState =>
      wasResetElsewhere()
        ? { status: "reset-elsewhere" }
        : isDeviceResetRequested()
          ? { status: "resetting" }
          : { status: "ready" },
  );

  useEffect(() => {
    if (state.status !== "resetting") {
      return;
    }
    let current = true;
    void completeReset(clearNativeCache).then(
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
  }, [clearNativeCache, completeReset, state.status]);

  useEffect(() => {
    if (state.status === "reset-elsewhere") {
      // What this tab kept for itself predates the reset; the flag that led
      // here goes with it, so the next reload boots the app.
      globalThis.sessionStorage?.clear();
      return;
    }
    if (state.status !== "ready") {
      return;
    }
    const releasePageLock = holdAppPageLock();
    const unsubscribe = reloadOnDeviceResetElsewhere();
    return () => {
      unsubscribe();
      releasePageLock();
    };
  }, [state.status]);

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

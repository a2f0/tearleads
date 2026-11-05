import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  hasSystemBootstrapCompleted,
  initialSystemBootstrapState,
  type SystemBootstrapState,
  type SystemBootstrapStatus,
  transitionSystemBootstrap,
} from "./systemBootstrapMachine";
import type {
  SystemBootstrapResult,
  SystemBootstrapRunInput,
} from "./systemBootstrapRun";

export interface SystemBootstrapContextValue {
  readonly ensureBootstrapped: () => Promise<SystemBootstrapResult>;
  readonly error: unknown;
  readonly isBootstrapping: boolean;
  readonly status: SystemBootstrapStatus;
}

export function useSystemBootstrapController(input: {
  readonly bootstrapInput: SystemBootstrapRunInput | null;
  readonly enabled: boolean;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly runBootstrap: (input: SystemBootstrapRunInput) => Promise<boolean>;
}): SystemBootstrapContextValue {
  const [state, dispatch] = useReducer(
    transitionSystemBootstrap,
    input.enabled,
    initialSystemBootstrapState,
  );
  const completedTargetKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef<Promise<SystemBootstrapResult> | null>(null);
  const latestInputRef = useRef<SystemBootstrapRunInput | null>(null);

  useEffect(() => {
    latestInputRef.current = input.bootstrapInput;
  }, [input.bootstrapInput]);

  const ensureBootstrapped =
    useCallback(async (): Promise<SystemBootstrapResult> => {
      while (true) {
        const nextInput = latestInputRef.current;
        if (!nextInput) {
          return { completed: false, skipped: true };
        }
        if (completedTargetKeyRef.current === nextInput.targetKey) {
          return { completed: true };
        }
        if (inFlightRef.current) {
          await inFlightRef.current;
          continue;
        }

        // The run is tagged with its input; the machine ignores results from
        // any run but the one it is running.
        const run = nextInput;
        // A newer input superseded this run while it was in flight (a
        // convergence re-key, or the controller was disabled). Let the effect
        // that changed it drive the next transition rather than clobbering
        // state (including the disabled "idle" reset) here.
        const superseded = (): boolean => {
          if (latestInputRef.current === run) {
            return false;
          }
          dispatch({
            inputMissing: latestInputRef.current === null,
            run,
            type: "run-superseded",
          });
          return true;
        };
        dispatch({ run, type: "run-started" });
        const bootstrapPromise = input
          .runBootstrap(run)
          .then((completed): SystemBootstrapResult => {
            if (superseded()) {
              return { completed: false, skipped: true };
            }
            if (completed) {
              completedTargetKeyRef.current = run.targetKey;
              dispatch({ run, type: "run-succeeded" });
              return { completed: true };
            }

            dispatch({ run, type: "run-incomplete" });
            return { completed: false };
          })
          .catch((error: unknown): SystemBootstrapResult => {
            if (superseded()) {
              return { completed: false, error };
            }
            input.logError("Failed to bootstrap system containers", error);
            dispatch({ error, run, type: "run-failed" });
            return { completed: false, error };
          })
          .finally(() => {
            if (inFlightRef.current === bootstrapPromise) {
              inFlightRef.current = null;
            }
          });

        inFlightRef.current = bootstrapPromise;
        return bootstrapPromise;
      }
    }, [input.logError, input.runBootstrap]);

  useEffect(() => {
    if (!input.enabled) {
      completedTargetKeyRef.current = null;
      latestInputRef.current = null;
      dispatch({ type: "disable" });
      return;
    }
    if (!input.bootstrapInput) {
      if (!inFlightRef.current) {
        dispatch({ type: "input-missing" });
      }
      return;
    }
    if (completedTargetKeyRef.current === input.bootstrapInput.targetKey) {
      dispatch({ type: "target-complete" });
      return;
    }

    void ensureBootstrapped();
  }, [ensureBootstrapped, input.bootstrapInput, input.enabled]);

  return useMemo(
    () => toContextValue(state, ensureBootstrapped),
    [ensureBootstrapped, state],
  );
}

function toContextValue(
  state: SystemBootstrapState,
  ensureBootstrapped: () => Promise<SystemBootstrapResult>,
): SystemBootstrapContextValue {
  return {
    ensureBootstrapped,
    error: state.status === "error" ? state.error : null,
    // Only the first provisioning run gates the UI. Re-runs after a completed
    // bootstrap (e.g. a container converging local-only -> synced re-keys the
    // target) reconcile in the background without blanking an open mini-app.
    isBootstrapping:
      state.status === "running" && !hasSystemBootstrapCompleted(state),
    status: state.status,
  };
}

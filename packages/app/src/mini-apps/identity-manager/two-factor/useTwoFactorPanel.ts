import {
  type TwoFactorAnswer,
  TwoFactorRequestError,
} from "@tearleads/client-sdk";
import { TWO_FACTOR_ERROR_CODES } from "@tearleads/validators/response";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import {
  INITIAL_TWO_FACTOR_PANEL_STATE,
  type TwoFactorPanelEvent,
  transitionTwoFactorPanel,
} from "./twoFactorPanelMachine";

export type TwoFactorAction = "disable" | "enable" | "regenerate" | "setup";

const REFUSALS: Readonly<Record<string, string>> = {
  [TWO_FACTOR_ERROR_CODES.invalidCode]: "That code did not match. Try again.",
  [TWO_FACTOR_ERROR_CODES.locked]:
    "Too many incorrect codes. Wait 15 minutes, then try again.",
  [TWO_FACTOR_ERROR_CODES.setupMissing]:
    "Setup expired. Start again to get a new key.",
};

function describeTwoFactorFailure(error: unknown): string {
  if (error instanceof TwoFactorRequestError) {
    return (error.code && REFUSALS[error.code]) ?? error.message;
  }
  return "Could not reach the server. Try again.";
}

/**
 * Drives the Two-Factor panel. Each request is tagged, so a slower answer to
 * an earlier request never overwrites a later one's outcome.
 */
export function useTwoFactorPanel() {
  const tearleads = useTearleads();
  const [state, dispatch] = useReducer(
    transitionTwoFactorPanel,
    INITIAL_TWO_FACTOR_PANEL_STATE,
  );
  const [busy, setBusy] = useState<TwoFactorAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    // A load supersedes any action in flight, whose result is then ignored.
    const tag = ++latest.current;
    setBusy(null);
    setError(null);
    dispatch({ type: "load" });
    try {
      const current = await tearleads.twoFactor.status();
      if (tag === latest.current) dispatch({ current, type: "loaded" });
    } catch (caught) {
      if (tag !== latest.current) return;
      dispatch({ message: describeTwoFactorFailure(caught), type: "failed" });
    }
  }, [tearleads]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (
      action: TwoFactorAction,
      work: () => Promise<TwoFactorPanelEvent>,
    ): Promise<boolean> => {
      const tag = ++latest.current;
      setBusy(action);
      setError(null);
      try {
        const event = await work();
        if (tag !== latest.current) return false;
        dispatch(event);
        return true;
      } catch (caught) {
        if (tag === latest.current) setError(describeTwoFactorFailure(caught));
        return false;
      } finally {
        if (tag === latest.current) setBusy(null);
      }
    },
    [],
  );

  const { twoFactor } = tearleads;
  return {
    acknowledgeCodes: load,
    beginSetup: () =>
      run("setup", async () => ({
        setup: await twoFactor.beginSetup(),
        type: "setup-started",
      })),
    busy,
    cancelSetup: () => {
      setError(null);
      dispatch({ type: "setup-cancelled" });
    },
    disable: (answer: TwoFactorAnswer) =>
      run("disable", async () => {
        await twoFactor.disable(answer);
        return { type: "disabled" };
      }),
    enable: (code: string, rememberDevice: boolean) =>
      run("enable", async () => ({
        recoveryCodes: await twoFactor.enable(code, { rememberDevice }),
        type: "codes-issued",
      })),
    error,
    regenerate: (answer: TwoFactorAnswer) =>
      run("regenerate", async () => ({
        recoveryCodes: await twoFactor.regenerateRecoveryCodes(answer),
        type: "codes-issued",
      })),
    retry: load,
    state,
  };
}

export type TwoFactorPanel = ReturnType<typeof useTwoFactorPanel>;

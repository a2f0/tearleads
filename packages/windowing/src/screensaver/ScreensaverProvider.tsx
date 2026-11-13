import { type ComponentType, type ReactNode, useMemo } from "react";
import { createRequiredContext } from "../createRequiredContext";
import { ScreensaverOverlay } from "./ScreensaverOverlay";
import { ScreensaverUnlock } from "./ScreensaverUnlock";
import type { ScreensaverPinVerifier } from "./screensaverPinVerifier";
import { useScreensaverController } from "./useScreensaverController";

export interface ScreensaverControls {
  start: () => void;
  stop: () => void;
  /** Artwork or PIN gate is visible; false can still consume a pending release. */
  isActive: boolean;
}
export interface ScreensaverProviderProps {
  children: ReactNode;
  screensaver: ComponentType;
  gracePeriodMs?: number;
  verifyPin?: ScreensaverPinVerifier | undefined;
}
const { context: ScreensaverContext, useRequired: useScreensaver } =
  createRequiredContext<ScreensaverControls>(
    "useScreensaver requires ScreensaverProvider",
  );

export { useScreensaver };

export function ScreensaverProvider({
  children,
  screensaver: Screensaver,
  gracePeriodMs = 2000,
  verifyPin,
}: ScreensaverProviderProps) {
  const { isActive, start, stop, state, submit, cancel, dismiss } =
    useScreensaverController(gracePeriodMs, verifyPin);
  const unlocking = state.status === "unlock" || state.status === "verifying";
  const value = useMemo(
    () => ({ start, stop, isActive }),
    [start, stop, isActive],
  );
  return (
    <ScreensaverContext.Provider value={value}>
      {children}
      {isActive && (
        <ScreensaverOverlay
          key={state.session}
          onStop={dismiss}
          locked={state.locked === true}
          interactive={unlocking}
        >
          {unlocking ? (
            <ScreensaverUnlock
              busy={state.status === "verifying"}
              error={state.status === "unlock" ? state.error : null}
              onSubmit={submit}
              onCancel={cancel}
            />
          ) : (
            <Screensaver />
          )}
        </ScreensaverOverlay>
      )}
    </ScreensaverContext.Provider>
  );
}

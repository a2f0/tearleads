import { type ComponentType, type ReactNode, useMemo } from "react";
import { createRequiredContext } from "../createRequiredContext";
import { ScreensaverOverlay } from "./ScreensaverOverlay";
import { useScreensaverController } from "./useScreensaverController";

export interface ScreensaverControls {
  start: () => void;
  stop: () => void;
  isActive: boolean;
}
export interface ScreensaverProviderProps {
  children: ReactNode;
  screensaver: ComponentType;
  gracePeriodMs?: number;
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
}: ScreensaverProviderProps) {
  const { isActive, start, stop, session } =
    useScreensaverController(gracePeriodMs);
  const value = useMemo(
    () => ({ start, stop, isActive }),
    [start, stop, isActive],
  );
  return (
    <ScreensaverContext.Provider value={value}>
      {children}
      {isActive && (
        <ScreensaverOverlay key={session} onStop={stop}>
          <Screensaver />
        </ScreensaverOverlay>
      )}
    </ScreensaverContext.Provider>
  );
}

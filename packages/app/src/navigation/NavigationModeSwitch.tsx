import {
  type NavigationMode,
  NavigationModeSwitch as WindowingNavigationModeSwitch,
} from "@tearleads/windowing";
import { classNames } from "../components/shared/classNames";
import { isCapacitor } from "../host/isCapacitor";

// The windowing package's windowed/routed switch, styled like the theme toggle
// so it docks in the lower-right tray. It always writes an explicit override so
// the user can switch between the default tablet shell and windows.
//
// It hides itself in the native Capacitor app, where the windowed layout is not
// an appropriate choice.

/**
 * @param mode - the layout currently showing this switch (windowed footer tray
 * or routed taskbar). Clicking forces the other mode.
 */
export function NavigationModeSwitch({
  mode,
  className,
  allowWindowed = false,
}: {
  mode: NavigationMode;
  className?: string | undefined;
  allowWindowed?: boolean | undefined;
}) {
  if (isCapacitor()) {
    return null;
  }

  return (
    <WindowingNavigationModeSwitch
      allowWindowed={allowWindowed}
      className={classNames(
        "tearleads-action-button tearleads-action-button--icon",
        className,
      )}
      mode={mode}
    />
  );
}

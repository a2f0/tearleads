import { AppWindowIcon } from "@phosphor-icons/react/dist/csr/AppWindow";
import { DeviceTabletIcon } from "@phosphor-icons/react/dist/csr/DeviceTablet";
import { classNames } from "../components/shared/classNames";
import { isCapacitor } from "../host/isCapacitor";
import {
  type AppNavigationMode,
  isWindowedLayoutEligible,
  readAppNavigationEnvironment,
} from "./AppNavigationMode";
import { useOptionalNavigationModeOverride } from "./NavigationModeOverrideProvider";

// A two-state (no "auto") layout control styled like the theme toggle so it
// docks in the lower-right tray. It forces one of the two concrete layouts and
// always writes an explicit override so the user can switch between the
// default tablet shell and windows.
//
// It hides itself in the native Capacitor app, where the windowed layout is not
// an appropriate choice.

const OTHER_MODE = {
  windowed: "routed",
  routed: "windowed",
} satisfies Record<AppNavigationMode, AppNavigationMode>;

const MODE_LABEL = {
  windowed: "windowed",
  routed: "iPad / mobile",
} satisfies Record<AppNavigationMode, string>;

// Show the glyph of the layout the click switches *to*, so the control reads as
// an action ("go to iPad/mobile") the way the theme toggle's invert glyph does.
const TARGET_ICON = {
  windowed: AppWindowIcon,
  routed: DeviceTabletIcon,
} satisfies Record<AppNavigationMode, typeof AppWindowIcon>;

/**
 * @param mode - the layout currently showing this switch (windowed footer tray
 * or routed taskbar). Clicking forces the other mode.
 */
export function NavigationModeSwitch({
  mode,
  className,
  allowWindowed = false,
}: {
  mode: AppNavigationMode;
  className?: string | undefined;
  allowWindowed?: boolean | undefined;
}) {
  const override = useOptionalNavigationModeOverride();
  if (
    !override ||
    isCapacitor() ||
    (mode === "routed" &&
      !allowWindowed &&
      !isWindowedLayoutEligible(readAppNavigationEnvironment()))
  ) {
    return null;
  }

  const target = OTHER_MODE[mode];
  const TargetIcon = TARGET_ICON[target];
  const label = `Switch to ${MODE_LABEL[target]} layout`;

  return (
    <button
      aria-label={label}
      className={classNames(
        "tearleads-action-button tearleads-action-button--icon",
        className,
      )}
      title={label}
      type="button"
      onClick={() => override.setOverride(target)}
    >
      <TargetIcon aria-hidden="true" focusable="false" size={20} />
    </button>
  );
}

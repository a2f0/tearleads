import { AppWindowIcon } from "@phosphor-icons/react/dist/csr/AppWindow";
import { DeviceTabletIcon } from "@phosphor-icons/react/dist/csr/DeviceTablet";
import { classNames } from "../components/shared/classNames";
import { isCapacitor } from "../host/isCapacitor";
import type { AppNavigationMode } from "./AppNavigationMode";
import { useOptionalNavigationModeOverride } from "./NavigationModeOverrideProvider";

// A two-state (no "auto") layout control styled like the theme toggle so it
// docks in the lower-right tray. It forces one of the two concrete layouts and
// always writes an explicit override — the manual choice the user reaches for
// to preview the iPad/mobile shell on a desktop (or drop back to windows).
//
// Which is why it hides itself in the native Capacitor app: previewing the
// phone/tablet shell is a desktop-browser affordance, and the windowed layout it
// offers to switch back to is not one a phone or tablet should ever land in.

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
}: {
  mode: AppNavigationMode;
  className?: string | undefined;
}) {
  const override = useOptionalNavigationModeOverride();
  if (!override || isCapacitor()) {
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

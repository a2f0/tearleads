import { AppWindowIcon } from "@phosphor-icons/react/dist/csr/AppWindow";
import { DeviceTabletIcon } from "@phosphor-icons/react/dist/csr/DeviceTablet";
import type { WindowingIcon } from "../icons/windowingIcon";
import { useOptionalNavigationModeOverride } from "./NavigationModeOverrideProvider";
import {
  isWindowedLayoutEligible,
  type NavigationMode,
  readNavigationEnvironment,
} from "./navigationMode";
import "./NavigationModeSwitch.css";

const OTHER_MODE = {
  windowed: "routed",
  routed: "windowed",
} satisfies Record<NavigationMode, NavigationMode>;

const MODE_LABEL = {
  windowed: "windowed",
  routed: "iPad / mobile",
} satisfies Record<NavigationMode, string>;

// Show the glyph of the layout the click switches *to*, so the control reads as
// an action ("go to iPad / mobile").
const TARGET_ICON = {
  windowed: AppWindowIcon,
  routed: DeviceTabletIcon,
} satisfies Record<NavigationMode, WindowingIcon>;

interface NavigationModeSwitchProps {
  /**
   * Offer windows even where they do not suit the screen, such as when the
   * host fixes the windowed layout.
   */
  allowWindowed?: boolean | undefined;
  /**
   * Classes for the button. They replace the default
   * `navigation-mode-switch` styling, so a host's own button styles apply
   * alone.
   */
  className?: string | undefined;
  /** The layout showing the switch; a click chooses the other. */
  mode: NavigationMode;
}

/**
 * The windowed/routed switch, for a taskbar's corner: a click records the
 * other layout as the user's choice with the nearest
 * {@link NavigationModeOverrideProvider}. It renders nothing outside one, and
 * the routed layout's switch hides where windows do not suit the screen.
 */
export function NavigationModeSwitch({
  allowWindowed = false,
  className,
  mode,
}: NavigationModeSwitchProps) {
  const override = useOptionalNavigationModeOverride();
  if (
    !override ||
    (mode === "routed" &&
      !allowWindowed &&
      !isWindowedLayoutEligible(readNavigationEnvironment()))
  ) {
    return null;
  }

  const target = OTHER_MODE[mode];
  const TargetIcon = TARGET_ICON[target];
  const label = `Switch to ${MODE_LABEL[target]} layout`;

  return (
    <button
      aria-label={label}
      className={className ?? "navigation-mode-switch"}
      title={label}
      type="button"
      onClick={() => override.setOverride(target)}
    >
      <TargetIcon aria-hidden="true" focusable="false" size={20} />
    </button>
  );
}

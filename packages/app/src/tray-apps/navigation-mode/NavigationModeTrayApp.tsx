import { NavigationModeSwitch } from "@tearleads/windowing";
import { isCapacitor } from "../../host/isCapacitor";
import { useAppNavigationState } from "../../navigation/AppNavigationProvider";
import { useAppHostConfig } from "../../providers/host/AppHostConfigProvider";

// The windowing package's windowed/routed switch, styled like the tray's other
// buttons. It offers the layout the pane is not showing and always writes an
// explicit override, so the user can switch between the default tablet shell
// and windows. A host that fixes the windowed layout keeps the switch back to
// windows even where they would not otherwise suit the screen.
function NavigationModeTrayButton() {
  const { mode } = useAppNavigationState();
  const { navigationMode } = useAppHostConfig();

  return (
    <NavigationModeSwitch
      allowWindowed={navigationMode === "windowed"}
      className="tearleads-action-button tearleads-action-button--icon"
      mode={mode}
    />
  );
}

/**
 * The Layout Switch tray app. It hides in the native Capacitor app, where the
 * windowed layout is not an appropriate choice.
 */
export function NavigationModeTrayApp() {
  return isCapacitor() ? null : <NavigationModeTrayButton />;
}

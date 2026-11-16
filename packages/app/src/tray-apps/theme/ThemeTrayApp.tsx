import { ThemeSwitch } from "@tearleads/windowing";

// The Theme Switch tray app: the windowing package's theme switch, styled like
// the tray's other buttons. Each click moves to the next of the host profile's
// themes. It renders nothing outside a ThemeProvider (e.g. a pane mounted
// standalone in tests).
export function ThemeTrayApp() {
  return (
    <ThemeSwitch className="tearleads-action-button tearleads-action-button--icon" />
  );
}

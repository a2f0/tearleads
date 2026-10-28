import { ThemeSwitch } from "@tearleads/windowing";

// The windowing package's theme switch, styled like the windowed and routed
// taskbars' other tray buttons. Each click moves to the
// next of the host profile's themes. It renders nothing outside a
// ThemeProvider (e.g. a pane mounted standalone in tests).
export function ThemeToggleButton() {
  return (
    <ThemeSwitch className="tearleads-action-button tearleads-action-button--icon" />
  );
}

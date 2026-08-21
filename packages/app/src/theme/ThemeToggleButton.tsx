import { ThemeInvertIcon } from "@symcrypt/ui";
import { useOptionalTheme } from "./ThemeProvider";

// The theme control that docks in the pane footer's system tray, next to the
// System Monitor launcher. A single square button cycles through the registered
// themes (Light <-> Dark today; more themes just extend the cycle). Renders
// nothing outside a ThemeProvider (e.g. a pane mounted standalone in tests),
// mirroring how WorkspaceSwitcher degrades without a WorkspaceProvider.
export function ThemeToggleButton() {
  const theme = useOptionalTheme();
  if (!theme) {
    return null;
  }

  const { nextTheme, toggleTheme } = theme;
  const label = `Switch to ${nextTheme.label} theme`;

  return (
    <button
      aria-label={label}
      className="symcrypt-action-button symcrypt-action-button--icon"
      title={label}
      type="button"
      onClick={toggleTheme}
    >
      <ThemeInvertIcon size={20} />
    </button>
  );
}

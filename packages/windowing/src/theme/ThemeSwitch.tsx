import { ThemeInvertIcon } from "../icons/ThemeInvertIcon";
import type { WindowingIcon } from "../icons/windowingIcon";
import { useOptionalTheme } from "./ThemeProvider";
import "./ThemeSwitch.css";

interface ThemeSwitchProps {
  /**
   * Classes for the button. They replace the default `theme-switch` styling,
   * so a host's own button styles apply alone.
   */
  className?: string | undefined;
  /** The glyph; by default a square half filled in the text color. */
  icon?: WindowingIcon | undefined;
}

/**
 * The theme switch, for a taskbar's corner: each click moves to the next of
 * the host's themes with the nearest {@link ThemeProvider}, and the button
 * names the theme it switches to. It renders nothing outside a provider, or
 * when the host offers a single theme.
 */
export function ThemeSwitch({
  className,
  icon: Icon = ThemeInvertIcon,
}: ThemeSwitchProps) {
  const theme = useOptionalTheme();
  if (!theme || theme.themes.length < 2) {
    return null;
  }

  const label = `Switch to ${theme.nextTheme.label} theme`;

  return (
    <button
      aria-label={label}
      className={className ?? "theme-switch"}
      title={label}
      type="button"
      onClick={theme.toggleTheme}
    >
      <Icon aria-hidden="true" focusable="false" size={20} />
    </button>
  );
}

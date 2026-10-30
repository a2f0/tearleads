import { useId } from "react";
import { useOptionalTheme } from "../theme/ThemeProvider";
import { useOptionalWallpaper } from "../wallpaper/WallpaperProvider";
import { wallpaperStyle } from "../wallpaper/wallpapers";
import { useSuppressWindowToolbar } from "../window/CurrentWindowContext";
import "../wallpaper/Wallpaper.css";
import "./DisplayProperties.css";

function BackgroundSection() {
  const wallpaper = useOptionalWallpaper();
  const name = useId();
  if (!wallpaper) {
    return null;
  }
  return (
    <fieldset className="display-properties-section">
      <legend>Background</legend>
      <div className="display-properties-wallpapers">
        {wallpaper.wallpapers.map((option) => (
          <label className="display-properties-wallpaper" key={option.id}>
            <input
              checked={option.id === wallpaper.activeWallpaper.id}
              className="display-properties-input"
              name={name}
              onChange={() => wallpaper.setWallpaper(option.id)}
              type="radio"
              value={option.id}
            />
            <span
              aria-hidden="true"
              className="display-properties-swatch wallpaper-pattern"
              data-pattern={option.tile ? "" : undefined}
              style={wallpaperStyle(option)}
            />
            <span className="display-properties-label">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ThemeSection() {
  const theme = useOptionalTheme();
  const name = useId();
  if (!theme || theme.themes.length < 2) {
    return null;
  }
  return (
    <fieldset className="display-properties-section">
      <legend>Theme</legend>
      <div className="display-properties-themes">
        {theme.themes.map((option) => (
          <label className="display-properties-theme" key={option.id}>
            <input
              checked={option.id === theme.activeTheme.id}
              className="display-properties-input"
              name={name}
              onChange={() => theme.setTheme(option.id)}
              type="radio"
              value={option.id}
            />
            <span className="display-properties-label">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The display settings, for a host's Display Properties mini-app: the
 * desktop's background, from the nearest {@link WallpaperProvider}, and the
 * color theme, from the nearest {@link ThemeProvider}. Each choice applies at
 * once. A section whose provider is missing, or that offers one option, is
 * left out. It has no toolbar actions, so its window shows no toolbar row.
 */
export function DisplayProperties() {
  useSuppressWindowToolbar(true);
  return (
    <div className="display-properties">
      <BackgroundSection />
      <ThemeSection />
    </div>
  );
}

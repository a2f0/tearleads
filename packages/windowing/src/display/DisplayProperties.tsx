import { useId } from "react";
import { useOptionalTheme } from "../theme/ThemeProvider";
import { useOptionalSystemTray } from "../tray/SystemTrayProvider";
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

function SystemTraySection() {
  const tray = useOptionalSystemTray();
  if (!tray || tray.definition.order.length === 0) {
    return null;
  }
  const { definition, isEnabled, setEnabled } = tray;
  return (
    <fieldset className="display-properties-section">
      <legend>System Tray</legend>
      <div className="display-properties-tray-apps">
        {definition.order.map((id) => {
          const app = definition.apps[id];
          if (!app) {
            return null;
          }
          const { icon: Icon, title } = app;
          return (
            <label className="display-properties-tray-app" key={id}>
              {Icon && (
                <Icon
                  aria-hidden="true"
                  className="display-properties-tray-app-icon"
                  focusable="false"
                  size={16}
                />
              )}
              <span className="display-properties-label">{title}</span>
              <input
                aria-checked={isEnabled(id)}
                checked={isEnabled(id)}
                className="display-properties-switch"
                onChange={(event) =>
                  setEnabled(id, event.currentTarget.checked)
                }
                role="switch"
                type="checkbox"
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The display settings, for a host's Display Properties mini-app: the
 * desktop's background, from the nearest {@link WallpaperProvider}; the color
 * theme, from the nearest {@link ThemeProvider}; and a switch per tray app,
 * from the nearest {@link SystemTrayProvider}. Each choice applies at once. A
 * section whose provider is missing, or that offers one theme or no tray
 * apps, is left out. It has no toolbar actions, so its window shows no
 * toolbar row.
 */
export function DisplayProperties() {
  useSuppressWindowToolbar(true);
  return (
    <div className="display-properties">
      <BackgroundSection />
      <ThemeSection />
      <SystemTraySection />
    </div>
  );
}

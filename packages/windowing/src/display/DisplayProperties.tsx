import { useId } from "react";
import { resolveLauncherOrder } from "../launcher/launcherDefinition";
import { useOptionalStartMenuPreferences } from "../menu/StartMenuPreferencesProvider";
import { useOptionalTheme } from "../theme/ThemeProvider";
import { useOptionalSystemTray } from "../tray/SystemTrayProvider";
import { useOptionalWallpaper } from "../wallpaper/WallpaperProvider";
import { wallpaperStyle } from "../wallpaper/wallpapers";
import { useSuppressWindowToolbar } from "../window/CurrentWindowContext";
import { AppSwitch } from "./AppSwitch";
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
          return (
            <AppSwitch
              key={id}
              className="display-properties-tray-app"
              icon={app.icon}
              title={app.title}
              checked={isEnabled(id)}
              onChange={(enabled) => setEnabled(id, enabled)}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

function StartMenuSection({
  appIds,
}: {
  appIds?: readonly string[] | undefined;
}) {
  const preferences = useOptionalStartMenuPreferences();
  if (!preferences) return null;
  const ids = (appIds ?? resolveLauncherOrder(preferences.definition)).filter(
    (id) => preferences.configurableIds.includes(id),
  );
  if (!ids.length) return null;
  return (
    <fieldset className="display-properties-section">
      <legend>Start menu</legend>
      <div className="display-properties-menu-apps">
        {ids.map((id) => {
          const app = preferences.definition.apps[id];
          return (
            app && (
              <AppSwitch
                key={id}
                icon={app.icon}
                className="display-properties-menu-app"
                title={app.iconLabel ?? app.title}
                checked={preferences.isVisible(id)}
                onChange={(visible) => preferences.setVisible(id, visible)}
              />
            )
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
export function DisplayProperties({
  startMenuAppIds,
}: {
  startMenuAppIds?: readonly string[];
} = {}) {
  useSuppressWindowToolbar(true);
  return (
    <div className="display-properties">
      <BackgroundSection />
      <ThemeSection />
      <SystemTraySection />
      <StartMenuSection appIds={startMenuAppIds} />
    </div>
  );
}

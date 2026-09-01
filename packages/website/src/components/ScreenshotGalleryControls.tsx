import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { DesktopTowerIcon } from "@phosphor-icons/react/dist/csr/DesktopTower";
import { DeviceMobileIcon } from "@phosphor-icons/react/dist/csr/DeviceMobile";
import { DeviceTabletIcon } from "@phosphor-icons/react/dist/csr/DeviceTablet";
import type { Icon } from "@phosphor-icons/react/dist/lib/types";
import { ThemeInvertIcon } from "@tearleads/ui";
import { projectLabel, themeLabel } from "./screenshotsManifest";

const PROJECT_ICONS: Readonly<Record<string, Icon>> = {
  web: DesktopTowerIcon,
  mobile: DeviceMobileIcon,
  ipad: DeviceTabletIcon,
};

export function ScreenshotsToolbar({
  projects,
  themes,
  project,
  theme,
  onProjectChange,
  onThemeChange,
  position,
}: {
  projects: string[];
  themes: string[];
  project: string;
  theme: string;
  onProjectChange: (id: string) => void;
  onThemeChange: (id: string) => void;
  position: string;
}) {
  return (
    <header className="screenshots-browser__toolbar">
      <div className="screenshots-browser__title">Screenshots</div>
      <fieldset className="screenshots-browser__toggle">
        <legend className="screenshots-browser__toggle-legend">Device</legend>
        {projects.map((id) => {
          const ProjectIcon = PROJECT_ICONS[id];
          return (
            <button
              key={id}
              type="button"
              className={
                id === project
                  ? "screenshots-browser__toggle-button screenshots-browser__toggle-button--active"
                  : "screenshots-browser__toggle-button"
              }
              onClick={() => onProjectChange(id)}
              aria-pressed={id === project}
            >
              {ProjectIcon ? (
                <ProjectIcon aria-hidden="true" size={18} />
              ) : null}
              <span>{projectLabel(id)}</span>
            </button>
          );
        })}
      </fieldset>
      <ThemeSwitcher themes={themes} theme={theme} onChange={onThemeChange} />
      <div className="screenshots-browser__counter">{position}</div>
    </header>
  );
}

function ThemeSwitcher({
  themes,
  theme,
  onChange,
}: {
  themes: string[];
  theme: string;
  onChange: (id: string) => void;
}) {
  if (themes.length < 2) {
    return null;
  }
  const currentIndex = Math.max(0, themes.indexOf(theme));
  const nextTheme = themes[(currentIndex + 1) % themes.length];
  if (!nextTheme) {
    return null;
  }
  const label = `Switch screenshots to ${themeLabel(nextTheme)} theme`;

  return (
    <button
      type="button"
      className="screenshots-browser__theme-button"
      onClick={() => onChange(nextTheme)}
      aria-label={label}
      title={label}
    >
      <ThemeInvertIcon size={20} />
    </button>
  );
}

export function ScreenshotStepControls({
  canStep,
  onStep,
}: {
  canStep: boolean;
  onStep: (delta: number) => void;
}) {
  return (
    <div className="screenshots-browser__navrow">
      <button
        type="button"
        className="screenshots-browser__nav"
        onClick={() => onStep(-1)}
        disabled={!canStep}
        aria-label="Previous screen"
      >
        <CaretLeftIcon aria-hidden="true" size={20} />
      </button>
      <button
        type="button"
        className="screenshots-browser__nav"
        onClick={() => onStep(1)}
        disabled={!canStep}
        aria-label="Next screen"
      >
        <CaretRightIcon aria-hidden="true" size={20} />
      </button>
    </div>
  );
}

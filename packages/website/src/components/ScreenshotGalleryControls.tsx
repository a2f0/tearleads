import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { DesktopTowerIcon } from "@phosphor-icons/react/dist/csr/DesktopTower";
import { DeviceMobileIcon } from "@phosphor-icons/react/dist/csr/DeviceMobile";
import { DeviceTabletIcon } from "@phosphor-icons/react/dist/csr/DeviceTablet";
import type { Icon } from "@phosphor-icons/react/dist/lib/types";
import { ThemeInvertIcon } from "@tearleads/ui";
import { projectLabel, screenLabel, themeLabel } from "./screenshotsManifest";

const PROJECT_ICONS: Readonly<Record<string, Icon>> = {
  windowed: DesktopTowerIcon,
  mobile: DeviceMobileIcon,
  tablet: DeviceTabletIcon,
};

export function ScreenshotsToolbar({
  projects,
  themes,
  project,
  theme,
  activeName,
  onProjectChange,
  onThemeChange,
}: {
  projects: string[];
  themes: string[];
  project: string;
  theme: string;
  activeName: string | undefined;
  onProjectChange: (id: string) => void;
  onThemeChange: (id: string) => void;
}) {
  return (
    <header className="screenshots-browser__toolbar">
      {/* Announces the new screen when the arrows or filmstrip step. */}
      <p className="screenshots-browser__title" aria-live="polite">
        {activeName ? screenLabel(activeName) : "No screens"}
      </p>
      <fieldset className="screenshots-browser__toggle">
        <legend className="visually-hidden">Layout</legend>
        {projects.map((id) => {
          const ProjectIcon = PROJECT_ICONS[id];
          return (
            <button
              key={id}
              type="button"
              className="screenshots-browser__toggle-button"
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
  const label = `Show ${themeLabel(nextTheme).toLowerCase()} theme`;

  return (
    <button
      type="button"
      className="screenshots-browser__icon-button"
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
  position,
}: {
  canStep: boolean;
  onStep: (delta: number) => void;
  /** "3 / 17": the active screen's place in the current layout's list. */
  position: string;
}) {
  return (
    <div className="screenshots-browser__navrow">
      <button
        type="button"
        className="screenshots-browser__icon-button"
        onClick={() => onStep(-1)}
        disabled={!canStep}
        aria-label="Previous screen"
      >
        <CaretLeftIcon aria-hidden="true" size={20} />
      </button>
      <p className="screenshots-browser__counter">{position}</p>
      <button
        type="button"
        className="screenshots-browser__icon-button"
        onClick={() => onStep(1)}
        disabled={!canStep}
        aria-label="Next screen"
      >
        <CaretRightIcon aria-hidden="true" size={20} />
      </button>
    </div>
  );
}

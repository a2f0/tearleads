import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./ScreenshotsBrowser.css";

// Manifest URL, staged into Astro's public/ by scripts/buildScreenshots.ts and
// served at the site root in both `astro dev` and the static build.
const MANIFEST_URL = "/screenshot-gallery/manifest.json";

// Mirror of the manifest shape written by scripts/buildScreenshots.ts. Kept in
// sync by hand (the script emits JSON; this reads it).
interface ScreenshotEntry {
  project: string;
  theme: string;
  name: string;
  src: string;
}
interface ScreenshotManifest {
  projects: string[];
  themes: string[];
  screens: string[];
  entries: ScreenshotEntry[];
}

// Friendlier labels for the device (capture project) toggle; falls back to a
// title-cased id for any project not listed here.
const PROJECT_LABELS: Record<string, string> = {
  web: "Windowed",
  mobile: "Mobile",
};

const THEME_LABELS: Record<string, string> = {
  light: "Light",
  dark: "Dark",
};

function titleCase(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function projectLabel(project: string): string {
  return PROJECT_LABELS[project] ?? titleCase(project);
}

function themeLabel(theme: string): string {
  return THEME_LABELS[theme] ?? titleCase(theme);
}

function entryKey(project: string, theme: string, name: string): string {
  return `${project} ${theme} ${name}`;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; manifest: ScreenshotManifest };

export function ScreenshotsBrowser() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(MANIFEST_URL)
      .then((response): Promise<ScreenshotManifest> => {
        if (!response.ok) {
          throw new Error(`Manifest request failed (${response.status})`);
        }
        return response.json();
      })
      .then((manifest) => {
        if (!cancelled) {
          setLoad({ status: "ready", manifest });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoad({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (load.status === "loading") {
    return <Shell status="Loading screenshots…" />;
  }
  if (load.status === "error") {
    return (
      <Shell
        status={`Could not load the screenshot manifest: ${load.message}`}
      />
    );
  }
  return <Gallery manifest={load.manifest} />;
}

/** Root chrome for the non-gallery states (loading / error / empty). */
function Shell({
  status,
  children,
}: {
  status?: string;
  children?: ReactNode;
}) {
  return (
    <div className="screenshots-browser" data-gallery-theme="light">
      {status ? (
        <p className="screenshots-browser__status">{status}</p>
      ) : (
        children
      )}
    </div>
  );
}

// Index entries by project+theme+name and derive the selected-device screen
// list, the active screen (tracked by name so a device toggle stays on the same
// screen where it exists), stepping, and gallery-scoped keyboard navigation.
function useGalleryNavigation(
  manifest: ScreenshotManifest,
  project: string,
  containerRef: RefObject<HTMLDivElement | null>,
) {
  const { themes } = manifest;
  // The selection is stored by screen name, not index: the web and mobile
  // captures don't share the same screen list (mobile has `home`, web doesn't),
  // so a numeric index would jump to a different screen when the device toggles.
  const [selectedName, setSelectedName] = useState<string | undefined>(
    undefined,
  );

  const bySrc = useMemo(() => {
    const map = new Map<string, ScreenshotEntry>();
    for (const entry of manifest.entries) {
      map.set(entryKey(entry.project, entry.theme, entry.name), entry);
    }
    return map;
  }, [manifest.entries]);

  // Screens available for the selected device, in the manifest's canonical
  // order. Keeps the filmstrip stable when toggling theme; a screen missing in
  // one theme renders an explanatory placeholder in the viewer instead.
  const screens = useMemo(
    () =>
      manifest.screens.filter((name) =>
        themes.some((availableTheme) =>
          bySrc.has(entryKey(project, availableTheme, name)),
        ),
      ),
    [manifest.screens, themes, bySrc, project],
  );

  // Resolve the active screen from the tracked name, falling back to the first
  // screen when the name is unset or absent for this device. Derived (not
  // stored), so switching device never strands the selection on a stale index.
  const activeName =
    selectedName && screens.includes(selectedName) ? selectedName : screens[0];
  const activeIndex = activeName ? screens.indexOf(activeName) : -1;

  const step = useCallback(
    (delta: number) => {
      if (screens.length === 0) {
        return;
      }
      const base = activeIndex < 0 ? 0 : activeIndex;
      const next = (base + delta + screens.length) % screens.length;
      setSelectedName(screens[next]);
    },
    [screens, activeIndex],
  );

  // Only intercept arrow keys when focus is inside the gallery, so the handler
  // never swallows page scrolling (or arrows on unrelated controls) while the
  // gallery merely happens to be mounted on the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container || !container.contains(document.activeElement)) {
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        step(1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, containerRef]);

  return { bySrc, screens, activeName, activeIndex, step, setSelectedName };
}

function Gallery({ manifest }: { manifest: ScreenshotManifest }) {
  const { projects, themes, entries } = manifest;
  const [project, setProject] = useState<string>(() => projects[0] ?? "");
  const [theme, setTheme] = useState<string>(() => themes[0] ?? "light");
  const containerRef = useRef<HTMLDivElement>(null);
  const { bySrc, screens, activeName, activeIndex, step, setSelectedName } =
    useGalleryNavigation(manifest, project, containerRef);

  if (entries.length === 0) {
    return (
      <Shell>
        <div className="screenshots-browser__empty">
          <h1>No screenshots yet</h1>
          <p>
            Run <code>bun run screenshots</code> from the repo root to capture
            them, then restart the dev server (the gallery is staged on
            <code>predev</code>) or rebuild.
          </p>
        </div>
      </Shell>
    );
  }

  const currentEntry = activeName
    ? bySrc.get(entryKey(project, theme, activeName))
    : undefined;

  return (
    <div
      className="screenshots-browser"
      data-gallery-theme={theme}
      ref={containerRef}
    >
      <Toolbar
        projects={projects}
        themes={themes}
        project={project}
        theme={theme}
        onProjectChange={setProject}
        onThemeChange={setTheme}
        position={
          screens.length === 0
            ? "0 / 0"
            : `${activeIndex + 1} / ${screens.length}`
        }
      />

      <div className="screenshots-browser__body">
        <Filmstrip
          screens={screens}
          activeIndex={activeIndex}
          thumbFor={(name) =>
            bySrc.get(entryKey(project, theme, name)) ??
            themes
              .map((t) => bySrc.get(entryKey(project, t, name)))
              .find(Boolean)
          }
          onSelect={(index) => setSelectedName(screens[index])}
        />
        <Stage
          project={project}
          theme={theme}
          name={activeName}
          entry={currentEntry}
          canStep={screens.length > 1}
          onStep={step}
        />
      </div>
    </div>
  );
}

function Toolbar({
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
      <Toggle
        label="Device"
        value={project}
        options={projects.map((id) => ({ id, label: projectLabel(id) }))}
        onChange={onProjectChange}
      />
      <Toggle
        label="Theme"
        value={theme}
        options={themes.map((id) => ({ id, label: themeLabel(id) }))}
        onChange={onThemeChange}
      />
      <div className="screenshots-browser__counter">{position}</div>
    </header>
  );
}

function Filmstrip({
  screens,
  activeIndex,
  thumbFor,
  onSelect,
}: {
  screens: string[];
  activeIndex: number;
  thumbFor: (name: string) => ScreenshotEntry | undefined;
  onSelect: (index: number) => void;
}) {
  return (
    <nav className="screenshots-browser__filmstrip" aria-label="Screens">
      {screens.map((name, index) => {
        const thumb = thumbFor(name);
        return (
          <button
            key={name}
            type="button"
            className={
              index === activeIndex
                ? "screenshots-browser__thumb screenshots-browser__thumb--active"
                : "screenshots-browser__thumb"
            }
            onClick={() => onSelect(index)}
            aria-current={index === activeIndex}
          >
            {thumb ? (
              <img src={thumb.src} alt="" loading="lazy" />
            ) : (
              <span className="screenshots-browser__thumb-missing" />
            )}
            <span className="screenshots-browser__thumb-label">
              {titleCase(name)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function Stage({
  project,
  theme,
  name,
  entry,
  canStep,
  onStep,
}: {
  project: string;
  theme: string;
  name: string | undefined;
  entry: ScreenshotEntry | undefined;
  canStep: boolean;
  onStep: (delta: number) => void;
}) {
  return (
    // A plain div, not <main>: the Astro page already provides the page's
    // <main> landmark, and a nested one is invalid.
    <div className="screenshots-browser__stage">
      <button
        type="button"
        className="screenshots-browser__nav screenshots-browser__nav--prev"
        onClick={() => onStep(-1)}
        disabled={!canStep}
        aria-label="Previous screen"
      >
        ‹
      </button>

      <div
        className={
          project === "mobile"
            ? "screenshots-browser__frame screenshots-browser__frame--mobile"
            : "screenshots-browser__frame"
        }
      >
        {entry ? (
          <img
            key={entry.src}
            className="screenshots-browser__image"
            src={entry.src}
            alt={`${projectLabel(project)} · ${theme} · ${name}`}
          />
        ) : (
          <div className="screenshots-browser__missing">
            <p>
              {name ? titleCase(name) : "This screen"} was not captured in{" "}
              {themeLabel(theme)} for {projectLabel(project)}.
            </p>
          </div>
        )}
      </div>

      <button
        type="button"
        className="screenshots-browser__nav screenshots-browser__nav--next"
        onClick={() => onStep(1)}
        disabled={!canStep}
        aria-label="Next screen"
      >
        ›
      </button>
    </div>
  );
}

interface ToggleOption {
  id: string;
  label: string;
}

function Toggle({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ToggleOption[];
  onChange: (id: string) => void;
}) {
  if (options.length === 0) {
    return null;
  }
  return (
    <fieldset className="screenshots-browser__toggle">
      <legend className="screenshots-browser__toggle-legend">{label}</legend>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={
            option.id === value
              ? "screenshots-browser__toggle-button screenshots-browser__toggle-button--active"
              : "screenshots-browser__toggle-button"
          }
          onClick={() => onChange(option.id)}
          aria-pressed={option.id === value}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

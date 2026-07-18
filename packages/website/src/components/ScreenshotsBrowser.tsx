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
import { Stage } from "./ScreenshotsStage";
import {
  entryKey,
  projectLabel,
  type ScreenshotEntry,
  type ScreenshotManifest,
  themeLabel,
  titleCase,
} from "./screenshotsManifest";

// Manifest URL, staged into Astro's public/ by scripts/buildScreenshots.ts and
// served at the site root in both `astro dev` and the static build.
const MANIFEST_URL = "/screenshot-gallery/manifest.json";

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
        <Stage
          project={project}
          theme={theme}
          name={activeName}
          entry={currentEntry}
        />
        <StepControls canStep={screens.length > 1} onStep={step} />
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
  const stripRef = useRef<HTMLElement>(null);

  // Keep the active thumb visible when arrows / nav buttons step to a screen
  // that is scrolled out of the strip. Manual scrollLeft math rather than
  // scrollIntoView so stepping can only ever scroll the strip, never the page.
  useEffect(() => {
    const strip = stripRef.current;
    const thumb = strip?.children.item(activeIndex);
    if (!strip || !(thumb instanceof HTMLElement)) {
      return;
    }
    const left = thumb.offsetLeft;
    const right = left + thumb.offsetWidth;
    if (left < strip.scrollLeft) {
      strip.scrollTo({ left, behavior: "smooth" });
    } else if (right > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: right - strip.clientWidth, behavior: "smooth" });
    }
  }, [activeIndex]);

  return (
    <nav
      className="screenshots-browser__filmstrip"
      aria-label="Screens"
      ref={stripRef}
    >
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

function StepControls({
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
        ‹
      </button>
      <button
        type="button"
        className="screenshots-browser__nav"
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

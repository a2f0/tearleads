import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

type ThemeScheme = "light" | "dark";

/**
 * The routed app bar is the native shell's top chrome, painted with the
 * --color-muted token in @tearleads/ui styles.css. These literals are only the
 * fallback for when that token cannot be resolved to an `rgb()` value; the live
 * token is read first so every theme's bar matches without listing it here.
 */
const TOP_CHROME_FALLBACK_BY_SCHEME: Record<ThemeScheme, string> = {
  light: "#eeeeee",
  dark: "#2e2e2e",
};

const TOP_CHROME_STYLE_BY_SCHEME: Record<ThemeScheme, Style> = {
  // Capacitor's names describe the background: Light supplies dark icons and
  // Dark supplies light icons.
  light: Style.Light,
  dark: Style.Dark,
};

function readThemeScheme(): ThemeScheme {
  // getAttribute rather than dataset: the repo enables both biome's
  // useLiteralKeys and TS noPropertyAccessFromIndexSignature, which demand
  // opposite dataset access forms.
  return document.documentElement.getAttribute("data-theme-scheme") === "dark"
    ? "dark"
    : "light";
}

/**
 * Resolves --color-muted to the `#rrggbb` form Android's status bar accepts.
 * A custom property reads back as its authored text (`#eee`, or an unevaluated
 * `color-mix(...)`), so it is applied to a hidden probe and read back as the
 * engine's resolved `rgb(...)` instead.
 */
function readTopChromeColor(): string | null {
  const probe = document.createElement("div");
  probe.style.display = "none";
  probe.style.backgroundColor = "var(--color-muted)";
  document.body.appendChild(probe);
  try {
    const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(
      getComputedStyle(probe).backgroundColor,
    );
    if (!match) {
      return null;
    }
    return `#${match
      .slice(1, 4)
      .map((channel) => Number(channel).toString(16).padStart(2, "0"))
      .join("")}`;
  } finally {
    probe.remove();
  }
}

function applyStatusBarTheme(): void {
  const scheme = readThemeScheme();

  void StatusBar.setStyle({
    style: TOP_CHROME_STYLE_BY_SCHEME[scheme],
  }).catch(() => undefined);

  if (Capacitor.getPlatform() === "android") {
    // iOS draws the webview under a transparent status bar (the app bar or
    // billing warning's safe-area-top padding shows through); Android paints
    // an opaque bar, so match it to the top chrome for a seamless edge.
    void StatusBar.setBackgroundColor({
      color: readTopChromeColor() ?? TOP_CHROME_FALLBACK_BY_SCHEME[scheme],
    }).catch(() => undefined);
  }
}

/**
 * Applies the status-bar style once at boot and re-applies it whenever
 * ThemeProvider re-stamps `<html data-theme>`, so the native bar always
 * matches the rendered chrome.
 */
export function syncStatusBarWithTheme(): void {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  applyStatusBarTheme();

  const observer = new MutationObserver(applyStatusBarTheme);
  observer.observe(document.documentElement, {
    attributes: true,
    // Both, because switching between two themes of the same scheme (Dark ->
    // Phosphor) changes only data-theme, yet still repaints the Android bar.
    attributeFilter: ["data-theme", "data-theme-scheme"],
  });
}

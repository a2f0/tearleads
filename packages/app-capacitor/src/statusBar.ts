import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

type ThemeId = "light" | "dark";

/**
 * The routed app bar is the native shell's top chrome. These literals mirror
 * the --color-muted token in @tearleads/ui styles.css; keep them in sync if
 * that surface changes color.
 */
const TOP_CHROME_BACKGROUND_BY_THEME: Record<ThemeId, string> = {
  light: "#eeeeee",
  dark: "#2e2e2e",
};

const TOP_CHROME_STYLE_BY_THEME: Record<ThemeId, Style> = {
  // Capacitor's names describe the background: Light supplies dark icons and
  // Dark supplies light icons.
  light: Style.Light,
  dark: Style.Dark,
};

function applyStatusBarTheme(): void {
  // getAttribute rather than dataset: the repo enables both biome's
  // useLiteralKeys and TS noPropertyAccessFromIndexSignature, which demand
  // opposite dataset access forms.
  const theme =
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";

  void StatusBar.setStyle({
    style: TOP_CHROME_STYLE_BY_THEME[theme],
  }).catch(() => undefined);

  if (Capacitor.getPlatform() === "android") {
    // iOS draws the webview under a transparent status bar (the app bar or
    // billing warning's safe-area-top padding shows through); Android paints
    // an opaque bar, so match it to the top chrome for a seamless edge.
    void StatusBar.setBackgroundColor({
      color: TOP_CHROME_BACKGROUND_BY_THEME[theme],
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
    attributeFilter: ["data-theme"],
  });
}

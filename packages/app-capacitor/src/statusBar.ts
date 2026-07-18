import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

/**
 * The frame header band is dark in BOTH themes (see --tearleads-header-background
 * in @tearleads/ui styles.css: #333 in Light, #161616 in Dark), so without this
 * sync the OS picks status-bar icon color from the SYSTEM appearance — dark
 * icons over the dark header whenever the device is in light mode.
 *
 * These literals mirror the styles.css tokens; keep them in sync if the header
 * band ever changes color.
 */
const HEADER_BACKGROUND_BY_THEME: Record<"light" | "dark", string> = {
  light: "#333333",
  dark: "#161616",
};

function applyStatusBarTheme(): void {
  // getAttribute rather than dataset: the repo enables both biome's
  // useLiteralKeys and TS noPropertyAccessFromIndexSignature, which demand
  // opposite dataset access forms.
  const theme =
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";

  // Style.Dark = light icons for a dark background — correct for both themes
  // because the header band underneath the status bar is always dark.
  void StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);

  if (Capacitor.getPlatform() === "android") {
    // iOS draws the webview under a transparent status bar (the header's
    // safe-area-top padding shows through); Android paints an opaque bar, so
    // match it to the header band for a seamless top edge.
    void StatusBar.setBackgroundColor({
      color: HEADER_BACKGROUND_BY_THEME[theme],
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

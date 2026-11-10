import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  SITE_DEFAULT_THEME,
  SITE_THEME_STORAGE_KEY,
  SITE_THEMES,
  stampSiteTheme,
} from "../siteTheme";
import { SiteNav } from "./SiteNav";

// The DOM is registered for this file only, and before React DOM loads, since
// react-dom detects the DOM when its module is first evaluated; a static
// import would load it first (as in SiteNav.test).
GlobalRegistrator.register();
const rtl = await import("@testing-library/react");

const root = document.documentElement;
const originalMatchMedia = window.matchMedia;

function setOsScheme(scheme: "light" | "dark"): void {
  window.matchMedia = (query: string): MediaQueryList => ({
    addEventListener: () => {},
    addListener: () => {},
    dispatchEvent: () => false,
    matches: scheme === "dark" && query === "(prefers-color-scheme: dark)",
    media: query,
    onchange: null,
    removeEventListener: () => {},
    removeListener: () => {},
  });
}

// The head script in Layout.astro, with the site's themes.
function stampBeforePaint(): void {
  stampSiteTheme(root, SITE_THEME_STORAGE_KEY, SITE_THEMES, SITE_DEFAULT_THEME);
}

function stamped() {
  return {
    scheme: root.getAttribute("data-theme-scheme"),
    theme: root.getAttribute("data-theme"),
  };
}

afterEach(() => {
  rtl.cleanup();
  localStorage.clear();
  root.removeAttribute("data-theme");
  root.removeAttribute("data-theme-scheme");
  window.matchMedia = originalMatchMedia;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

test("before paint, a stored pick wins over the OS scheme", () => {
  setOsScheme("dark");
  localStorage.setItem(SITE_THEME_STORAGE_KEY, "site-light");
  stampBeforePaint();
  expect(stamped()).toEqual({ scheme: "light", theme: "site-light" });
});

test("before paint, no pick or one the site no longer offers follows the OS", () => {
  setOsScheme("dark");
  stampBeforePaint();
  expect(stamped()).toEqual({ scheme: "dark", theme: "site-dark" });

  setOsScheme("light");
  localStorage.setItem(SITE_THEME_STORAGE_KEY, "dark");
  stampBeforePaint();
  expect(stamped()).toEqual({ scheme: "light", theme: "site-light" });
});

test("the hydrated nav keeps the stamp, and its switch persists a pick", () => {
  setOsScheme("dark");
  stampBeforePaint();
  const view = rtl.render(<SiteNav pathname="/" />);
  expect(stamped()).toEqual({ scheme: "dark", theme: "site-dark" });

  const toggle = view.getByRole("button", { name: "Switch to Light theme" });
  rtl.fireEvent.click(toggle);
  expect(stamped()).toEqual({ scheme: "light", theme: "site-light" });
  expect(localStorage.getItem(SITE_THEME_STORAGE_KEY)).toBe("site-light");
  expect(toggle.getAttribute("aria-label")).toBe("Switch to Dark theme");

  // The next page's head script restores the pick.
  rtl.cleanup();
  stampBeforePaint();
  expect(stamped()).toEqual({ scheme: "light", theme: "site-light" });
});

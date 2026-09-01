import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ThemeProvider } from "./ThemeProvider";
import { ThemeToggleButton } from "./ThemeToggleButton";

const CHOICE_KEY = "tearleads.theme.choice";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const originalMatchMedia = window.matchMedia;

// A controllable matchMedia so the tests can assert the OS default and drive a
// live preference change. Returns `matches` for the dark-scheme query and
// exposes an emitter that fires the registered "change" listeners.
function installMatchMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => ({
    matches: query === DARK_QUERY ? dark : false,
    media: query,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
    // Legacy no-ops so the shape is a plausible MediaQueryList.
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;

  return {
    setDark(next: boolean) {
      dark = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  globalThis.localStorage.removeItem(CHOICE_KEY);
  document.documentElement.removeAttribute("data-theme");
});

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggleButton />
    </ThemeProvider>,
  );
}

test("defaults to the OS light preference and labels the toggle for the next theme", () => {
  installMatchMedia(false);

  const view = renderToggle();

  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  expect(view.getByRole("button").getAttribute("aria-label")).toBe(
    "Switch to Dark theme",
  );
  // The OS-derived default is not an explicit choice, so nothing is persisted.
  expect(globalThis.localStorage.getItem(CHOICE_KEY)).toBeNull();
});

test("defaults to the OS dark preference when the system prefers dark", () => {
  installMatchMedia(true);

  const view = renderToggle();

  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(view.getByRole("button").getAttribute("aria-label")).toBe(
    "Switch to Light theme",
  );
  expect(globalThis.localStorage.getItem(CHOICE_KEY)).toBeNull();
});

test("follows a live OS preference change while the user has not chosen", () => {
  const media = installMatchMedia(false);

  const view = renderToggle();
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");

  act(() => {
    media.setDark(true);
  });

  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  // Still no explicit choice — the app is tracking the system, not storing it.
  expect(globalThis.localStorage.getItem(CHOICE_KEY)).toBeNull();
  expect(view.getByRole("button").getAttribute("aria-label")).toBe(
    "Switch to Light theme",
  );
});

test("toggling advances from the OS default, persists the choice, and restamps the root", () => {
  installMatchMedia(false);

  const view = renderToggle();

  fireEvent.click(view.getByRole("button"));

  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(globalThis.localStorage.getItem(CHOICE_KEY)).toBe("dark");
  expect(view.getByRole("button").getAttribute("aria-label")).toBe(
    "Switch to Light theme",
  );
});

test("an explicit choice wins over the OS preference and its live changes", () => {
  const media = installMatchMedia(true);
  // The user has explicitly chosen light while the OS prefers dark.
  globalThis.localStorage.setItem(CHOICE_KEY, "light");

  const view = renderToggle();
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");

  // A later OS flip does not move an explicitly chosen theme.
  act(() => {
    media.setDark(false);
  });
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  expect(view.getByRole("button").getAttribute("aria-label")).toBe(
    "Switch to Dark theme",
  );
});

test("restores the persisted choice on mount", () => {
  installMatchMedia(false);
  globalThis.localStorage.setItem(CHOICE_KEY, "dark");

  const view = renderToggle();

  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(view.getByRole("button").getAttribute("aria-label")).toBe(
    "Switch to Light theme",
  );
});

test("ThemeToggleButton renders nothing without a ThemeProvider", () => {
  const view = render(<ThemeToggleButton />);

  expect(view.queryByRole("button")).toBe(null);
});

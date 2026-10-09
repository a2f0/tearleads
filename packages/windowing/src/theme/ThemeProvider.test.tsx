import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from "@testing-library/react";
import type { WindowingIconProps } from "../icons/windowingIcon";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { ThemeSwitch } from "./ThemeSwitch";
import type { DefaultTheme, ThemeDefinition } from "./themes";

const STORAGE_KEY = "test.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const THEMES = [
  { id: "paper", label: "Paper", scheme: "light" },
  { id: "ink", label: "Ink", scheme: "dark" },
  { id: "dusk", label: "Dusk", scheme: "dark" },
] as const satisfies readonly ThemeDefinition[];

type TestThemeId = (typeof THEMES)[number]["id"];

const FOLLOW_OS = { dark: "ink", light: "paper" } as const;

const originalMatchMedia = window.matchMedia;

// A controllable OS preference: matchMedia answers the dark-scheme query and
// notifies its listeners when the test flips it.
function installOsScheme(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<EventListenerOrEventListenerObject>();
  window.matchMedia = (query: string): MediaQueryList => ({
    addEventListener: (
      _type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      listeners.add(listener);
    },
    addListener: () => {},
    dispatchEvent: () => false,
    matches: query === DARK_QUERY && dark,
    media: query,
    onchange: null,
    removeEventListener: (
      _type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      listeners.delete(listener);
    },
    removeListener: () => {},
  });
  return {
    setDark(next: boolean) {
      dark = next;
      const event = new Event("change");
      for (const listener of listeners) {
        if (typeof listener === "function") {
          listener(event);
        } else {
          listener.handleEvent(event);
        }
      }
    },
  };
}

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  globalThis.localStorage.removeItem(STORAGE_KEY);
});

function rootTheme() {
  const root = document.documentElement;
  return {
    scheme: root.getAttribute("data-theme-scheme"),
    theme: root.getAttribute("data-theme"),
  };
}

function renderSwitch(
  defaultTheme: DefaultTheme<TestThemeId> = FOLLOW_OS,
  themes: readonly ThemeDefinition<TestThemeId>[] = THEMES,
) {
  return render(
    <ThemeProvider
      defaultTheme={defaultTheme}
      storageKey={STORAGE_KEY}
      themes={themes}
    >
      <ThemeSwitch />
    </ThemeProvider>,
  );
}

const switchLabel = (view: ReturnType<typeof render>) =>
  view.getByRole("button").getAttribute("aria-label");

test("follows the OS light preference without persisting it", () => {
  installOsScheme(false);

  const view = renderSwitch();

  expect(rootTheme()).toEqual({ scheme: "light", theme: "paper" });
  expect(switchLabel(view)).toBe("Switch to Ink theme");
  expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBeNull();
});

test("follows the OS dark preference, and its live changes", () => {
  const os = installOsScheme(true);

  const view = renderSwitch();
  expect(rootTheme()).toEqual({ scheme: "dark", theme: "ink" });

  act(() => os.setDark(false));

  expect(rootTheme()).toEqual({ scheme: "light", theme: "paper" });
  expect(switchLabel(view)).toBe("Switch to Ink theme");
  expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBeNull();
});

test("a single default theme ignores the OS preference", () => {
  installOsScheme(false);

  renderSwitch("dusk");

  expect(rootTheme()).toEqual({ scheme: "dark", theme: "dusk" });
});

test("the switch cycles every theme in order, persisting each choice", () => {
  installOsScheme(false);

  const view = renderSwitch();
  const button = view.getByRole("button");

  const steps = [
    ["ink", "dark", "Switch to Dusk theme"],
    ["dusk", "dark", "Switch to Paper theme"],
    ["paper", "light", "Switch to Ink theme"],
  ] as const;
  for (const [theme, scheme, nextLabel] of steps) {
    fireEvent.click(button);

    expect(rootTheme()).toEqual({ scheme, theme });
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe(theme);
    expect(button.getAttribute("aria-label")).toBe(nextLabel);
    expect(button.getAttribute("title")).toBe(nextLabel);
  }
});

test("a stored choice wins over the OS preference and its changes", () => {
  const os = installOsScheme(true);
  globalThis.localStorage.setItem(STORAGE_KEY, "dusk");

  renderSwitch();
  expect(rootTheme()).toEqual({ scheme: "dark", theme: "dusk" });

  act(() => os.setDark(false));

  expect(rootTheme()).toEqual({ scheme: "dark", theme: "dusk" });
});

test("a stored theme the host no longer offers counts as no choice", () => {
  installOsScheme(false);
  globalThis.localStorage.setItem(STORAGE_KEY, "solarized");

  renderSwitch();

  expect(rootTheme()).toEqual({ scheme: "light", theme: "paper" });
});

test("a default the host does not offer falls back to its first theme", () => {
  installOsScheme(true);

  renderSwitch({ dark: "dusk", light: "paper" }, THEMES.slice(0, 2));

  expect(rootTheme()).toEqual({ scheme: "light", theme: "paper" });
});

test("setTheme picks a theme by id and ignores ids the host does not offer", () => {
  installOsScheme(false);
  const { result } = renderHook(() => useTheme(), {
    wrapper: ({ children }) => (
      <ThemeProvider
        defaultTheme={FOLLOW_OS}
        storageKey={STORAGE_KEY}
        themes={THEMES}
      >
        {children}
      </ThemeProvider>
    ),
  });

  act(() => result.current.setTheme("dusk"));
  expect(result.current.activeTheme.id).toBe("dusk");
  expect(result.current.nextTheme.id).toBe("paper");

  act(() => result.current.setTheme("solarized"));
  expect(result.current.activeTheme.id).toBe("dusk");
  expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe("dusk");
  expect(result.current.themes).toBe(THEMES);
});

test("unmounting clears the theme from the document root", () => {
  installOsScheme(false);

  const view = renderSwitch();
  expect(rootTheme().theme).toBe("paper");

  view.unmount();

  expect(rootTheme()).toEqual({ scheme: null, theme: null });
});

test("useTheme throws outside a provider", () => {
  expect(() => renderHook(() => useTheme())).toThrow(
    "useTheme must be used within a ThemeProvider",
  );
});

test("the switch renders nothing without a provider", () => {
  const view = render(<ThemeSwitch />);

  expect(view.queryByRole("button")).toBeNull();
});

test("the switch renders nothing when the host offers one theme", () => {
  installOsScheme(false);

  const view = renderSwitch("paper", THEMES.slice(0, 1));

  expect(view.queryByRole("button")).toBeNull();
  expect(rootTheme().theme).toBe("paper");
});

test("a host's classes and icon replace the switch's defaults", () => {
  installOsScheme(false);
  function HostIcon({ size }: WindowingIconProps) {
    return <i data-size={size} data-testid="host-icon" />;
  }

  const view = render(
    <ThemeProvider
      defaultTheme={FOLLOW_OS}
      storageKey={STORAGE_KEY}
      themes={THEMES}
    >
      <ThemeSwitch />
      <ThemeSwitch className="host-button" icon={HostIcon} />
    </ThemeProvider>,
  );

  const [standard, hosted] = view.getAllByRole("button");
  expect(standard?.className).toBe("theme-switch");
  expect(standard?.querySelector("svg")).not.toBeNull();
  expect(hosted?.className).toBe("host-button");
  expect(view.getByTestId("host-icon").getAttribute("data-size")).toBe("20");
});

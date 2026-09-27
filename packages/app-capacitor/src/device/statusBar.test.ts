import { afterAll, beforeEach, expect, mock, test } from "bun:test";

// This package's tests run without a DOM, so the handful of globals statusBar.ts
// touches are faked here: the root attributes ThemeProvider stamps, the probe
// element it styles with `var(--color-muted)`, the engine's resolved color for
// that probe, and the observer that re-applies on a theme change.

interface Probe {
  readonly style: { display?: string; backgroundColor?: string };
  removed: boolean;
  remove(): void;
}

interface ObservedRoot {
  readonly callback: () => void;
  readonly target: unknown;
  readonly options: MutationObserverInit;
}

const fixture: {
  native: boolean;
  platform: string;
  attributes: Map<string, string>;
  resolvedMuted: string;
  probes: Probe[];
  styles: string[];
  backgrounds: string[];
  observed: ObservedRoot | null;
} = {
  native: true,
  platform: "android",
  attributes: new Map(),
  resolvedMuted: "",
  probes: [],
  styles: [],
  backgrounds: [],
  observed: null,
};

mock.module("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => fixture.native,
    getPlatform: () => fixture.platform,
  },
}));

mock.module("@capacitor/status-bar", () => ({
  Style: { Light: "LIGHT", Dark: "DARK" },
  StatusBar: {
    setStyle: ({ style }: { style: string }) => {
      fixture.styles.push(style);
      return Promise.resolve();
    },
    setBackgroundColor: ({ color }: { color: string }) => {
      fixture.backgrounds.push(color);
      return Promise.resolve();
    },
  },
}));

const documentElement = {
  getAttribute: (name: string) => fixture.attributes.get(name) ?? null,
};

class FakeMutationObserver {
  readonly #callback: () => void;

  constructor(callback: () => void) {
    this.#callback = callback;
  }

  observe(target: unknown, options: MutationObserverInit): void {
    fixture.observed = { callback: this.#callback, target, options };
  }
}

const fakeGlobals: Record<string, unknown> = {
  document: {
    documentElement,
    body: {
      appendChild: (probe: Probe) => {
        fixture.probes.push(probe);
        return probe;
      },
    },
    createElement: () => {
      const probe: Probe = {
        style: {},
        removed: false,
        remove() {
          probe.removed = true;
        },
      };
      return probe;
    },
  },
  // Resolves only the token the status bar is meant to read, so a probe styled
  // with anything else comes back empty and fails the color assertions.
  getComputedStyle: (probe: Probe) => ({
    backgroundColor:
      probe.style.backgroundColor === "var(--color-muted)"
        ? fixture.resolvedMuted
        : "",
  }),
  MutationObserver: FakeMutationObserver,
};

const originalGlobals = new Map(
  Object.keys(fakeGlobals).map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
for (const [key, value] of Object.entries(fakeGlobals)) {
  Object.defineProperty(globalThis, key, { value, configurable: true });
}

afterAll(() => {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
});

const { syncStatusBarWithTheme } = await import("./statusBar");

beforeEach(() => {
  fixture.native = true;
  fixture.platform = "android";
  fixture.attributes = new Map();
  fixture.resolvedMuted = "";
  fixture.probes = [];
  fixture.styles = [];
  fixture.backgrounds = [];
  fixture.observed = null;
});

function stampTheme(theme: string, scheme: string, resolvedMuted: string) {
  fixture.attributes.set("data-theme", theme);
  fixture.attributes.set("data-theme-scheme", scheme);
  fixture.resolvedMuted = resolvedMuted;
}

function reapply(): void {
  const observed = fixture.observed;
  if (!observed) {
    throw new Error("status bar never observed the document root");
  }
  observed.callback();
}

test("paints the icon style and the resolved app-bar color at boot", () => {
  stampTheme("light", "light", "rgb(238, 238, 238)");

  syncStatusBarWithTheme();

  expect(fixture.styles).toEqual(["LIGHT"]);
  expect(fixture.backgrounds).toEqual(["#eeeeee"]);
  // The probe is detached again once its color has been read.
  expect(fixture.probes.map((probe) => probe.removed)).toEqual([true]);
});

test("repaints on a switch between two dark themes that keeps the scheme", () => {
  stampTheme("dark", "dark", "rgb(46, 46, 46)");
  syncStatusBarWithTheme();

  // Dark -> Dusk changes only data-theme, so the observer must watch it,
  // not just the scheme, or the Android bar keeps Dark's grey.
  expect(fixture.observed?.target).toBe(documentElement);
  expect(fixture.observed?.options.attributeFilter).toEqual([
    "data-theme",
    "data-theme-scheme",
  ]);

  stampTheme("dusk", "dark", "rgb(41, 50, 66)");
  reapply();

  expect(fixture.styles).toEqual(["DARK", "DARK"]);
  expect(fixture.backgrounds).toEqual(["#2e2e2e", "#293242"]);
});

test("converts an rgba() resolution to the opaque hex Android accepts", () => {
  stampTheme("dusk", "dark", "rgba(23, 29, 40, 0.5)");

  syncStatusBarWithTheme();

  expect(fixture.backgrounds).toEqual(["#171d28"]);
});

test("falls back to the scheme's literal when the token is not rgb()", () => {
  // A color-mix() token serializes as color(srgb …), which is not parsed.
  stampTheme("dusk", "dark", "color(srgb 0.16 0.20 0.26)");
  syncStatusBarWithTheme();
  expect(fixture.backgrounds).toEqual(["#2e2e2e"]);

  stampTheme("light", "light", "");
  reapply();
  expect(fixture.backgrounds).toEqual(["#2e2e2e", "#eeeeee"]);
});

test("treats a root without a scheme attribute as light", () => {
  // Boot runs before ThemeProvider has stamped anything.
  syncStatusBarWithTheme();

  expect(fixture.styles).toEqual(["LIGHT"]);
  expect(fixture.backgrounds).toEqual(["#eeeeee"]);
});

test("sets only the icon style on iOS, whose bar is transparent", () => {
  fixture.platform = "ios";
  stampTheme("dusk", "dark", "rgb(41, 50, 66)");

  syncStatusBarWithTheme();

  expect(fixture.styles).toEqual(["DARK"]);
  expect(fixture.backgrounds).toEqual([]);
  expect(fixture.probes).toEqual([]);
});

test("does nothing off a native platform", () => {
  fixture.native = false;
  stampTheme("dusk", "dark", "rgb(41, 50, 66)");

  syncStatusBarWithTheme();

  expect(fixture.styles).toEqual([]);
  expect(fixture.backgrounds).toEqual([]);
  expect(fixture.observed).toBe(null);
});

import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { DisplayProperties } from "../display/DisplayProperties";
import { LauncherNavigationProvider } from "../launcher/LauncherNavigationProvider";
import { RoutedPane } from "../routed/RoutedPane";
import {
  forceMobileRoutedTier,
  forceTabletRoutedTier,
  TEST_LAUNCHER,
} from "../routed/routedPane.testUtils";
import { WindowStateProvider } from "../window/WindowStateProvider";
import { StartMenu } from "./StartMenu";
import {
  StartMenuPreferencesProvider,
  useStartMenuPreferences,
} from "./StartMenuPreferencesProvider";

const KEY = "test.startMenu.visibility";
const app = { title: "Mail", createComponent: () => () => null };
const definition = {
  order: ["mail", "settings"],
  apps: {
    mail: app,
    notes: { ...app, title: "Notes", startMenuVisibility: "hidden" },
    settings: { ...app, title: "Settings", startMenuVisibility: "pinned" },
  },
} as const;
const items = ["mail", "notes", "settings", "screensaver"].map((id) => ({
  id,
  label: id,
  onSelect() {},
}));

afterEach(() => {
  cleanup();
  localStorage.removeItem(`${KEY}.mail`);
  localStorage.removeItem(`${KEY}.notes`);
});

function Reset() {
  const { reset } = useStartMenuPreferences();
  return (
    <button type="button" onClick={reset}>
      Reset
    </button>
  );
}

function open() {
  const view = render(
    <StartMenuPreferencesProvider definition={definition} storageKey={KEY}>
      <StartMenu icon="Start" items={items} />
      <DisplayProperties startMenuAppIds={["mail", "notes", "settings"]} />
      <Reset />
    </StartMenuPreferencesProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "Menu" }));
  return view;
}

test("choices update the menu, survive a remount and reset to the host defaults", () => {
  localStorage.setItem(`${KEY}.notes`, "invalid");
  let view = open();
  expect(view.queryByRole("button", { name: "notes" })).toBeNull();
  expect(view.queryByRole("switch", { name: "Settings" })).toBeNull();
  const switches = within(view.getByRole("group", { name: "Start menu" }));
  fireEvent.click(switches.getByRole("switch", { name: "Notes" }));
  fireEvent.click(switches.getByRole("switch", { name: "Mail" }));
  view.unmount();
  view = open();
  expect(view.queryByRole("button", { name: "mail" })).toBeNull();
  for (const name of ["notes", "settings", "screensaver"])
    expect(view.getByRole("button", { name })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Reset" }));
  expect(view.getByRole("button", { name: "mail" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "notes" })).toBeNull();
});

test("changing an app preserves a separate tab's choice for another app", () => {
  const view = open();
  localStorage.setItem(`${KEY}.notes`, "true");
  fireEvent.click(view.getByRole("switch", { name: "Mail" }));
  expect(localStorage.getItem(`${KEY}.notes`)).toBe("true");
  // A failed write would leave this tab with only its in-memory Mail choice.
  localStorage.removeItem(`${KEY}.mail`);
  fireEvent(
    window,
    new StorageEvent("storage", { key: `${KEY}.notes`, newValue: "true" }),
  );
  expect(view.getByRole("switch", { name: "Notes" })).toHaveProperty(
    "checked",
    true,
  );
  expect(view.getByRole("button", { name: "notes" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "mail" })).toBeNull();
});

for (const tier of ["mobile", "tablet"] as const) {
  test(`${tier} launcher keeps keyboard focus when another tab hides the active control`, async () => {
    const restore =
      tier === "mobile" ? forceMobileRoutedTier() : forceTabletRoutedTier();
    try {
      const view = render(
        <StartMenuPreferencesProvider
          definition={TEST_LAUNCHER}
          storageKey={KEY}
        >
          <WindowStateProvider>
            <LauncherNavigationProvider
              definition={TEST_LAUNCHER}
              mode="routed"
            >
              {tier === "tablet" && <RoutedPane menuIcon="First menu" />}
              <RoutedPane menuIcon="Menu" />
            </LauncherNavigationProvider>
          </WindowStateProvider>
        </StartMenuPreferencesProvider>,
      );
      for (const toggle of view.getAllByRole("button", {
        name: tier === "mobile" ? "Menu" : "Expand navigation rail",
      }))
        fireEvent.click(toggle);
      const launchers = view.getAllByRole("navigation", { name: "Apps" });
      const lastLauncher = launchers.at(-1);
      if (!lastLauncher) throw new Error("Missing launcher");
      const launcher = within(lastLauncher);
      const notes = launcher.getByRole("link", { name: "Notes" });
      notes.focus();
      if (tier === "tablet") {
        fireEvent.contextMenu(notes);
        expect(document.activeElement).toBe(
          view.getByRole("button", { name: "Open" }),
        );
      } else expect(document.activeElement).toBe(notes);
      localStorage.setItem(`${KEY}.notes`, "false");
      fireEvent(window, new StorageEvent("storage", { key: `${KEY}.notes` }));
      await Promise.resolve();
      expect(view.queryByRole("link", { name: "Notes" })).toBeNull();
      expect(document.activeElement).toBe(
        launcher.getByRole("link", { name: "Explorer" }),
      );
    } finally {
      restore();
    }
  });
}

test("switching preference keys preserves mounted app content", () => {
  const snapshots: boolean[] = [];
  function Probe() {
    const preferences = useStartMenuPreferences();
    useLayoutEffect(() => {
      snapshots.push(preferences.isVisible("notes"));
    });
    return null;
  }
  function desktop(storageKey: string) {
    return (
      <StartMenuPreferencesProvider
        definition={definition}
        storageKey={storageKey}
      >
        <Probe />
        <input aria-label="Draft" />
        <DisplayProperties startMenuAppIds={["mail", "notes", "settings"]} />
      </StartMenuPreferencesProvider>
    );
  }
  const view = render(desktop(KEY));
  const draft = view.getByRole("textbox");
  fireEvent.input(draft, { target: { value: "Unsaved text" } });
  fireEvent.click(view.getByRole("switch", { name: "Notes" }));
  snapshots.length = 0;
  view.rerender(desktop("test.otherMenu"));
  expect(snapshots[0]).toBe(false);
  expect(view.getByRole("switch", { name: "Notes" })).toHaveProperty(
    "checked",
    false,
  );
  expect(view.getByRole("textbox")).toBe(draft);
  expect(draft).toHaveProperty("value", "Unsaved text");
});

test("the default switches follow the launcher order", () => {
  const view = render(
    <StartMenuPreferencesProvider storageKey={KEY} definition={definition}>
      <DisplayProperties />
    </StartMenuPreferencesProvider>,
  );
  expect(view.getByRole("switch", { name: "Mail" })).toBeTruthy();
  expect(view.queryByRole("switch", { name: "Notes" })).toBeNull();
});

test("equivalent host definitions preserve an in-memory choice", () => {
  function shell() {
    return (
      <StartMenuPreferencesProvider
        storageKey={KEY}
        definition={{ ...definition, apps: { ...definition.apps } }}
      >
        <DisplayProperties />
      </StartMenuPreferencesProvider>
    );
  }
  const view = render(shell());
  fireEvent.click(view.getByRole("switch", { name: "Mail" }));
  localStorage.removeItem(`${KEY}.mail`);
  view.rerender(shell());
  expect(view.getByRole("switch", { name: "Mail" })).toHaveProperty(
    "checked",
    false,
  );
});

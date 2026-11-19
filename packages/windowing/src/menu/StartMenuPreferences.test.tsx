import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { DisplayProperties } from "../display/DisplayProperties";
import { LauncherNavigationProvider } from "../launcher/LauncherNavigationProvider";
import { RoutedPane } from "../routed/RoutedPane";
import {
  forceMobileRoutedTier,
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
      <DisplayProperties />
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

test("a routed launcher keeps keyboard focus when another tab hides the focused entry", async () => {
  const restore = forceMobileRoutedTier();
  try {
    const view = render(
      <StartMenuPreferencesProvider definition={TEST_LAUNCHER} storageKey={KEY}>
        <WindowStateProvider>
          <LauncherNavigationProvider definition={TEST_LAUNCHER} mode="routed">
            <RoutedPane menuIcon="Menu" />
          </LauncherNavigationProvider>
        </WindowStateProvider>
      </StartMenuPreferencesProvider>,
    );
    fireEvent.click(view.getByRole("button", { name: "Menu" }));
    const notes = view.getByRole("link", { name: "Notes" });
    notes.focus();
    expect(document.activeElement).toBe(notes);
    localStorage.setItem(`${KEY}.notes`, "false");
    fireEvent(window, new StorageEvent("storage", { key: `${KEY}.notes` }));
    await Promise.resolve();
    expect(view.queryByRole("link", { name: "Notes" })).toBeNull();
    expect(document.activeElement).toBe(
      view.getByRole("link", { name: "Explorer" }),
    );
  } finally {
    restore();
  }
});

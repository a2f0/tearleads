import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { DisplayProperties } from "../display/DisplayProperties";
import { StartMenu } from "./StartMenu";
import {
  StartMenuPreferencesProvider,
  useStartMenuPreferences,
} from "./StartMenuPreferencesProvider";

const KEY = "test.startMenu.visibility";
const app = { title: "Mail", createComponent: () => () => null };
const definition = {
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
  localStorage.removeItem(KEY);
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
  localStorage.setItem(KEY, "{invalid");
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

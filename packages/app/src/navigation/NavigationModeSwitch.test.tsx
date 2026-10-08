import { afterEach, expect, test } from "bun:test";
import { NavigationModeOverrideProvider } from "@tearleads/windowing";
import { cleanup, render } from "@testing-library/react";
import { NavigationModeSwitch } from "./NavigationModeSwitch";

// The windowing package's own tests cover the switch; these cover the app's
// dressing of it.

const STORAGE_KEY = "tearleads.navigation.mode";

afterEach(() => {
  cleanup();
  delete window.Capacitor;
  globalThis.localStorage.removeItem(STORAGE_KEY);
});

test("docks in the tray as a theme-toggle style action button", () => {
  const view = render(
    <NavigationModeOverrideProvider storageKey={STORAGE_KEY}>
      <NavigationModeSwitch mode="windowed" />
    </NavigationModeOverrideProvider>,
  );

  expect(
    view.getByRole("button", { name: "Switch to iPad / mobile layout" })
      .className,
  ).toBe("tearleads-action-button tearleads-action-button--icon");
  view.unmount();
});

test("hides itself in the native capacitor app", () => {
  window.Capacitor = { isNativePlatform: () => true };

  const view = render(
    <NavigationModeOverrideProvider storageKey={STORAGE_KEY}>
      <NavigationModeSwitch mode="routed" />
    </NavigationModeOverrideProvider>,
  );

  expect(view.container.querySelector("button")).toBeNull();
  view.unmount();
});

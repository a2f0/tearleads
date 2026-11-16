import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { NavigationModeTrayApp } from "./NavigationModeTrayApp";

// The windowing package's own tests cover the switch; this covers the app's
// dressing of it.

afterEach(() => {
  cleanup();
  delete window.Capacitor;
});

test("hides itself in the native capacitor app", () => {
  window.Capacitor = { isNativePlatform: () => true };

  const view = render(<NavigationModeTrayApp />);

  expect(view.container.querySelector("button")).toBeNull();
});

import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  NavigationModeOverrideProvider,
  useNavigationModeOverride,
} from "./NavigationModeOverrideProvider";
import { NavigationModeSwitch } from "./NavigationModeSwitch";

afterEach(() => {
  cleanup();
  delete window.Capacitor;
});

// Surfaces the current override alongside the switch so a test can read what the
// click set on the shared (in-memory) override.
function OverrideReadout() {
  const { override } = useNavigationModeOverride();
  return <output>{override ?? "auto"}</output>;
}

test("renders nothing without a provider, mirroring the theme toggle", () => {
  const view = render(<NavigationModeSwitch mode="windowed" />);
  expect(view.container.querySelector("button")).toBeNull();
  view.unmount();
});

test("the windowed switch offers (and selects) the iPad/mobile layout", () => {
  const view = render(
    <NavigationModeOverrideProvider>
      <NavigationModeSwitch mode="windowed" />
      <OverrideReadout />
    </NavigationModeOverrideProvider>,
  );

  const button = view.getByRole("button", {
    name: "Switch to iPad / mobile layout",
  });
  fireEvent.click(button);

  expect(view.getByText("routed")).toBeTruthy();
  view.unmount();
});

test("hides itself in the native capacitor app", () => {
  window.Capacitor = { isNativePlatform: () => true };

  const view = render(
    <NavigationModeOverrideProvider>
      <NavigationModeSwitch mode="routed" />
    </NavigationModeOverrideProvider>,
  );

  expect(view.container.querySelector("button")).toBeNull();
  view.unmount();
});

test("the routed switch offers (and selects) the windowed layout", () => {
  const view = render(
    <NavigationModeOverrideProvider>
      <NavigationModeSwitch mode="routed" />
      <OverrideReadout />
    </NavigationModeOverrideProvider>,
  );

  const button = view.getByRole("button", {
    name: "Switch to windowed layout",
  });
  fireEvent.click(button);

  expect(view.getByText("windowed")).toBeTruthy();
  view.unmount();
});

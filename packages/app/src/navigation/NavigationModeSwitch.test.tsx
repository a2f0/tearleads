import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  NavigationModeOverrideProvider,
  useNavigationModeOverride,
} from "./NavigationModeOverrideProvider";
import { NavigationModeSwitch } from "./NavigationModeSwitch";

const CHOICE_KEY = "tearleads.navigationMode.choice";

afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem(CHOICE_KEY);
});

// Surfaces the current override alongside the switch so a test can read what the
// click wrote without reaching into storage.
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
  expect(globalThis.localStorage.getItem(CHOICE_KEY)).toBe("routed");
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
  expect(globalThis.localStorage.getItem(CHOICE_KEY)).toBe("windowed");
  view.unmount();
});

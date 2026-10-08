import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  NavigationModeOverrideProvider,
  useNavigationModeOverride,
} from "./NavigationModeOverrideProvider";
import { NavigationModeSwitch } from "./NavigationModeSwitch";

const STORAGE_KEY = "test.navigationMode";

afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem(STORAGE_KEY);
});

// Surfaces the current override alongside the switch so a test can read what the
// click set on the shared override.
function OverrideReadout() {
  const { override } = useNavigationModeOverride();
  return <output>{override ?? "auto"}</output>;
}

test("renders nothing without a provider", () => {
  const view = render(<NavigationModeSwitch mode="windowed" />);
  expect(view.container.querySelector("button")).toBeNull();
  view.unmount();
});

test("the windowed switch offers (and selects) the iPad/mobile layout", () => {
  const view = render(
    <NavigationModeOverrideProvider storageKey={STORAGE_KEY}>
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

test("a host's classes replace the default styling", () => {
  const view = render(
    <NavigationModeOverrideProvider storageKey={STORAGE_KEY}>
      <NavigationModeSwitch mode="windowed" />
      <NavigationModeSwitch className="host-button" mode="windowed" />
    </NavigationModeOverrideProvider>,
  );

  expect(view.getAllByRole("button").map((button) => button.className)).toEqual(
    ["navigation-mode-switch", "host-button"],
  );
  view.unmount();
});

test("the routed switch offers (and selects) the windowed layout", () => {
  const view = render(
    <NavigationModeOverrideProvider storageKey={STORAGE_KEY}>
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

  const reloaded = render(
    <NavigationModeOverrideProvider storageKey={STORAGE_KEY}>
      <OverrideReadout />
    </NavigationModeOverrideProvider>,
  );
  expect(reloaded.getByText("windowed")).toBeTruthy();
  reloaded.unmount();
});

test("narrow screens hide the windowed switch unless the host forces windows", () => {
  const originalWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 900,
  });

  try {
    const view = render(
      <NavigationModeOverrideProvider storageKey={STORAGE_KEY}>
        <NavigationModeSwitch mode="routed" />
        <NavigationModeSwitch allowWindowed mode="routed" />
      </NavigationModeOverrideProvider>,
    );
    expect(
      view.getAllByRole("button", { name: "Switch to windowed layout" }),
    ).toHaveLength(1);
    view.unmount();
  } finally {
    if (originalWidth) {
      Object.defineProperty(window, "innerWidth", originalWidth);
    } else {
      Reflect.deleteProperty(window, "innerWidth");
    }
  }
});

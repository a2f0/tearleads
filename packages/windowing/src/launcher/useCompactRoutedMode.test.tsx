import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { WindowStateProvider } from "../window/WindowStateProvider";
import { LauncherNavigationProvider } from "./LauncherNavigationProvider";
import type { LauncherDefinition } from "./launcherDefinition";
import type { NavigationMode } from "./navigationMode";
import { useCompactRoutedMode } from "./useCompactRoutedMode";

const EmptyMiniApp = () => null;

const TEST_LAUNCHER: LauncherDefinition = {
  apps: {
    contacts: { createComponent: () => EmptyMiniApp, title: "Contacts" },
    explorer: { createComponent: () => EmptyMiniApp, title: "Explorer" },
  },
};

afterEach(() => {
  cleanup();
});

function forceMobileRoutedTier(): () => void {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  return () => {
    window.matchMedia = originalMatchMedia;
  };
}

function CompactRoutedModeProbe() {
  return (
    <div data-testid="compact-routed-mode">
      {String(useCompactRoutedMode())}
    </div>
  );
}

function renderCompactRoutedModeProbe(mode: NavigationMode) {
  return render(
    <WindowStateProvider>
      <LauncherNavigationProvider definition={TEST_LAUNCHER} mode={mode}>
        <CompactRoutedModeProbe />
      </LauncherNavigationProvider>
    </WindowStateProvider>,
  );
}

test("compact routed mode requires both routed navigation and mobile tier", () => {
  const restoreMatchMedia = forceMobileRoutedTier();

  try {
    const routed = renderCompactRoutedModeProbe("routed");
    expect(routed.getByTestId("compact-routed-mode").textContent).toBe("true");
    routed.unmount();

    const windowed = renderCompactRoutedModeProbe("windowed");
    expect(windowed.getByTestId("compact-routed-mode").textContent).toBe(
      "false",
    );
  } finally {
    restoreMatchMedia();
  }
});

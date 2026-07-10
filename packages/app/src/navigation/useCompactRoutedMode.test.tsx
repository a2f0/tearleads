import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { WindowStateProvider } from "../components/window/WindowStateProvider";
import type { MiniAppDefinition, MiniAppId } from "../mini-apps/types";
import type { AppNavigationMode } from "./AppNavigationMode";
import { AppNavigationProvider } from "./AppNavigationProvider";
import { useCompactRoutedMode } from "./useCompactRoutedMode";

const EmptyMiniApp = () => null;

const TEST_MINI_APPS: Readonly<Record<MiniAppId, MiniAppDefinition>> = {
  "backup-restore": { createComponent: () => EmptyMiniApp, title: "Backup" },
  contacts: { createComponent: () => EmptyMiniApp, title: "Contacts" },
  explorer: { createComponent: () => EmptyMiniApp, title: "Explorer" },
  "identity-manager": { createComponent: () => EmptyMiniApp, title: "ID" },
  notes: { createComponent: () => EmptyMiniApp, title: "Notes" },
  "org-manager": { createComponent: () => EmptyMiniApp, title: "Org Manager" },
  "system-monitor": {
    createComponent: () => EmptyMiniApp,
    title: "System Monitor",
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

function renderCompactRoutedModeProbe(mode: AppNavigationMode) {
  return render(
    <WindowStateProvider>
      <AppNavigationProvider mode={mode} miniApps={TEST_MINI_APPS}>
        <CompactRoutedModeProbe />
      </AppNavigationProvider>
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

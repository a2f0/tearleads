import { afterEach, expect, test } from "bun:test";
import { MiniAppRouteSegmentsProvider } from "@tearleads/windowing";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createAppHostConfig } from "../../host/AppHostConfig";
import { TELEMETRY_CONSENT_STORAGE_KEY } from "../../host/telemetryConsent";
import { AppHostConfigProvider } from "../../providers/host/AppHostConfigProvider";
import { SettingsApp } from "./SettingsApp";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

function renderSettings() {
  const hostConfig = createAppHostConfig({
    apiBaseUrl: "http://localhost:3001",
    wsUrl: "ws://localhost:3001/events",
  });
  const view = render(
    <AppHostConfigProvider value={hostConfig}>
      <MiniAppRouteSegmentsProvider
        appId="display-properties"
        canGoBack={false}
        goBack={() => {}}
        pathSegments={[]}
        setPathSegments={() => {}}
        windowId="settings"
      >
        <SettingsApp />
      </MiniAppRouteSegmentsProvider>
    </AppHostConfigProvider>,
  );
  return { consent: hostConfig.telemetryConsent, view };
}

test("Settings opens on General, whose telemetry switch starts off", () => {
  const { view } = renderSettings();
  const tabs = view.getAllByRole("tab").map((tab) => tab.textContent);
  expect(tabs).toEqual([
    "General",
    "Desktop",
    "System tray",
    "Start menu",
    "Network",
  ]);
  expect(
    view.getByRole("tab", { name: "General" }).getAttribute("aria-selected"),
  ).toBe("true");
  const telemetry = view.getByRole("switch", {
    name: "Share anonymous telemetry",
  });
  expect(telemetry).toHaveProperty("checked", false);
  expect(telemetry.getAttribute("aria-checked")).toBe("false");
  expect(telemetry.hasAttribute("aria-describedby")).toBe(false);
  expect(view.container.querySelector(".telemetry-consent")?.textContent).toBe(
    "Share anonymous telemetry",
  );
});

test("the switch opts the device in and out, and follows changes made elsewhere", () => {
  const { consent, view } = renderSettings();
  const telemetry = () =>
    view.getByRole("switch", { name: "Share anonymous telemetry" });

  fireEvent.click(telemetry());
  expect(consent.enabled()).toBe(true);
  expect(globalThis.localStorage.getItem(TELEMETRY_CONSENT_STORAGE_KEY)).toBe(
    "enabled",
  );
  expect(telemetry()).toHaveProperty("checked", true);

  act(() => consent.setEnabled(false));
  expect(telemetry()).toHaveProperty("checked", false);
});

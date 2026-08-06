import { afterEach, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  renderPane,
} from "../../../../test/helpers/paneTestUtils";
import { createAppBuildInfo } from "../../../host/AppHostConfig";
import { ENVIRONMENT_LABELS } from "./useSystemEnvironment";

afterEach(async () => {
  await cleanupPaneTestEnvironment();
  window.history.replaceState(null, "", "/");
});

function installClipboard(writeText: Clipboard["writeText"]): void {
  Object.defineProperty(Navigator.prototype, "clipboard", {
    configurable: true,
    get: () => ({ writeText }),
  });
}

const TEST_BUILD_INFO = createAppBuildInfo({
  commit: "abc1234",
  target: "web",
  version: "9.9.9",
});

function openMonitor() {
  const view = renderPane({
    hostConfig: createTestHostConfig().withOverrides({
      buildInfo: TEST_BUILD_INFO,
    }),
    pinSystemMonitor: false,
  });
  fireEvent.click(view.getByRole("button", { name: "System Monitor" }));
  return view;
}

async function openEnvironmentTab() {
  const view = openMonitor();
  fireEvent.click(await view.findByRole("tab", { name: "Environment" }));
  return view;
}

test("environment tab joins the tab list without displacing the existing tabs", async () => {
  const view = openMonitor();

  const environmentTab = await view.findByRole("tab", { name: "Environment" });
  expect(environmentTab.getAttribute("aria-selected")).toBe("false");
  // Logs stays the default; Environment is additive.
  expect(
    view.getByRole("tab", { name: "Logs" }).getAttribute("aria-selected"),
  ).toBe("true");

  fireEvent.click(environmentTab);
  expect(environmentTab.getAttribute("aria-selected")).toBe("true");
  expect(
    view.container
      .querySelector(".system-monitor-environment-table")
      ?.classList.contains("mini-app-info-table--borderless"),
  ).toBe(true);

  view.unmount();
});

test("environment tab reports build identity from the host config", async () => {
  const view = await openEnvironmentTab();

  expect(view.getByText(ENVIRONMENT_LABELS.platform)).toBeTruthy();
  expect(view.getByText("web")).toBeTruthy();
  expect(view.getByText("9.9.9")).toBeTruthy();
  expect(view.getByText("abc1234")).toBeTruthy();
  // The native build number row is always present; with no reader on the web
  // test host config it stays unknown rather than dropping the row.
  expect(view.getByText(ENVIRONMENT_LABELS.buildNumber)).toBeTruthy();

  view.unmount();
});

test("environment tab reports the native build number from the host config reader", async () => {
  const view = renderPane({
    hostConfig: createTestHostConfig().withOverrides({
      buildInfo: TEST_BUILD_INFO,
      readNativeBuildNumber: () => Promise.resolve("1042"),
    }),
    pinSystemMonitor: false,
  });
  fireEvent.click(view.getByRole("button", { name: "System Monitor" }));
  fireEvent.click(await view.findByRole("tab", { name: "Environment" }));

  expect(view.getByText(ENVIRONMENT_LABELS.buildNumber)).toBeTruthy();
  // The reader resolves after mount, so the row updates in place.
  expect(await view.findByText("1042")).toBeTruthy();

  view.unmount();
});

test("environment tab reports the backend api and websocket urls", async () => {
  const view = await openEnvironmentTab();

  // The configured endpoints, so a release that fell back to the localhost dev
  // default (unreachable from a device) is diagnosable at a glance rather than
  // reading as an unexplained "offline".
  expect(view.getByText(ENVIRONMENT_LABELS.apiUrl)).toBeTruthy();
  expect(view.getByText(ENVIRONMENT_LABELS.wsUrl)).toBeTruthy();
  expect(view.getByText("http://localhost:3001")).toBeTruthy();

  view.unmount();
});

test("environment tab reports the app theme and the os color scheme separately", async () => {
  const view = await openEnvironmentTab();

  // Two distinct rows: the app's stored theme is a user choice and routinely
  // disagrees with the OS preference.
  expect(view.getByText(ENVIRONMENT_LABELS.appTheme)).toBeTruthy();
  expect(view.getByText(ENVIRONMENT_LABELS.osColorScheme)).toBeTruthy();

  view.unmount();
});

test("environment tab always reports the raw user agent", async () => {
  const view = await openEnvironmentTab();

  expect(view.getByText(ENVIRONMENT_LABELS.userAgent)).toBeTruthy();
  expect(view.getByText(navigator.userAgent)).toBeTruthy();

  view.unmount();
});

test("copy button is in the toolbar and reachable from every tab", async () => {
  const view = openMonitor();

  // Still on the default Logs tab.
  await view.findByRole("tab", { name: "Logs" });
  const copyButton = view.getByRole("button", {
    name: "Copy report for support",
  });
  expect(copyButton.closest(".window-toolbar")).not.toBeNull();
  expect(copyButton.closest(".mini-app-tabs")).toBeNull();

  view.unmount();
});

test("copy button serializes every tab regardless of which one is open", async () => {
  const copied: string[] = [];
  installClipboard((value) => {
    copied.push(value);
    return Promise.resolve();
  });

  // Deliberately left on the Logs tab: the Status and Environment tabs are
  // never mounted, and their sections must still be captured.
  const view = openMonitor();
  await view.findByRole("tab", { name: "Logs" });

  fireEvent.click(
    view.getByRole("button", { name: "Copy report for support" }),
  );

  expect(copied).toHaveLength(1);
  const report = copied[0] ?? "";
  expect(report).toContain("# System Monitor Report");
  expect(report).toContain("## Environment");
  expect(report).toContain("## Status");
  expect(report).toContain("## Logs");
  expect(report).toContain(`| ${ENVIRONMENT_LABELS.appVersion} | 9.9.9 |`);
  expect(report).toContain(`| ${ENVIRONMENT_LABELS.buildCommit} | abc1234 |`);
  // Status comes from the snapshot, not from a mounted Status tab.
  expect(report).toContain("| SQLite Worker |");

  view.unmount();
});

test("copy report omits feature flags while developer mode is off", async () => {
  const copied: string[] = [];
  installClipboard((value) => {
    copied.push(value);
    return Promise.resolve();
  });

  const view = openMonitor();
  await view.findByRole("tab", { name: "Logs" });
  expect(view.queryByRole("tab", { name: "Feature Flags" })).toBeNull();

  fireEvent.click(
    view.getByRole("button", { name: "Copy report for support" }),
  );

  expect(copied[0] ?? "").not.toContain("## Feature Flags");

  view.unmount();
});

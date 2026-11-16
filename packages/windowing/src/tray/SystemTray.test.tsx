import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { DisplayProperties } from "../display/DisplayProperties";
import { SystemTray, type SystemTrayMenuItem } from "./SystemTray";
import { SystemTrayProvider } from "./SystemTrayProvider";
import type { SystemTrayDefinition } from "./systemTrayDefinition";

const TRAY_KEY = "test.tray.disabled";

function ClockApp() {
  return <button type="button">12:00</button>;
}

function VolumeApp() {
  return <button type="button">Volume</button>;
}

function HiddenApp() {
  return null;
}

const TRAY: SystemTrayDefinition<"clock" | "hidden" | "volume"> = {
  apps: {
    clock: { component: ClockApp, title: "Clock" },
    hidden: { component: HiddenApp, title: "Hidden" },
    volume: { component: VolumeApp, title: "Volume" },
  },
  order: ["volume", "hidden", "clock"],
};

afterEach(() => {
  cleanup();
  localStorage.removeItem(TRAY_KEY);
});

function Providers({ children }: { children: ReactNode }) {
  return (
    <SystemTrayProvider definition={TRAY} storageKey={TRAY_KEY}>
      {children}
    </SystemTrayProvider>
  );
}

// The tray's controls, start to end, by their visible names.
function trayControls(container: HTMLElement): string[] {
  const tray = within(container).getByRole("list", { name: "System tray" });
  return Array.from(
    tray.querySelectorAll("button"),
    (button) => button.textContent ?? "",
  );
}

test("shows the apps in order, and a context menu turns one off for good", () => {
  const view = render(<SystemTray />, { wrapper: Providers });
  expect(trayControls(view.container)).toEqual(["Volume", "12:00"]);

  fireEvent.contextMenu(view.getByRole("button", { name: "12:00" }), {
    clientX: 30,
    clientY: 40,
  });
  fireEvent.click(view.getByRole("button", { name: "Disable Clock" }));

  expect(trayControls(view.container)).toEqual(["Volume"]);
  expect(document.querySelector(".menu")).toBeNull();
  expect(JSON.parse(localStorage.getItem(TRAY_KEY) ?? "null")).toEqual([
    "clock",
  ]);

  cleanup();
  const remounted = render(<SystemTray />, { wrapper: Providers });
  expect(trayControls(remounted.container)).toEqual(["Volume"]);
});

test("a context menu offers the host's items below Disable", () => {
  const onSelect = mock(() => {});
  const menuItems: SystemTrayMenuItem[] = [
    { id: "settings", label: "Display Properties", onSelect },
  ];
  const view = render(<SystemTray menuItems={menuItems} />, {
    wrapper: Providers,
  });

  fireEvent.contextMenu(view.getByRole("button", { name: "Volume" }));
  const labels = Array.from(
    document.querySelectorAll(".menu .menu-item-label"),
    (label) => label.textContent,
  );
  expect(labels).toEqual(["Disable Volume", "Display Properties"]);

  fireEvent.click(view.getByRole("button", { name: "Display Properties" }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(view.getByRole("button", { name: "Volume" })).toBeDefined();
});

test("Display Properties switches each tray app off and back on", () => {
  const view = render(
    <>
      <SystemTray />
      <DisplayProperties />
    </>,
    { wrapper: Providers },
  );
  const section = within(view.getByRole("group", { name: "System Tray" }));
  expect(
    section
      .getAllByRole("switch")
      .map((toggle) => toggle.closest("label")?.textContent),
  ).toEqual(["Volume", "Hidden", "Clock"]);
  const volume = section.getByRole("switch", { name: "Volume" });
  expect(volume).toHaveProperty("checked", true);

  fireEvent.click(volume);
  expect(volume).toHaveProperty("checked", false);
  expect(view.queryByRole("button", { name: "Volume" })).toBeNull();

  fireEvent.click(volume);
  expect(volume).toHaveProperty("checked", true);
  expect(view.getByRole("button", { name: "Volume" })).toBeDefined();
  expect(JSON.parse(localStorage.getItem(TRAY_KEY) ?? "null")).toEqual([]);
});

test("unreadable storage leaves every app on", () => {
  localStorage.setItem(TRAY_KEY, "{not json");
  const view = render(<SystemTray />, { wrapper: Providers });
  expect(trayControls(view.container)).toEqual(["Volume", "12:00"]);
});

test("renders nothing without a provider, and Display Properties leaves out the section", () => {
  const view = render(
    <>
      <SystemTray />
      <DisplayProperties />
    </>,
  );
  expect(view.container.querySelector(".system-tray")).toBeNull();
  expect(view.queryByRole("group", { name: "System Tray" })).toBeNull();
});

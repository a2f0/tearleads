import { afterEach, expect, mock, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import { DisplayProperties } from "../display/DisplayProperties";
import { Menu } from "../menu/Menu";
import { SystemTray, type SystemTrayMenuItem } from "./SystemTray";
import { SystemTrayProvider, useSystemTray } from "./SystemTrayProvider";
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
  expect(JSON.parse(localStorage.getItem(TRAY_KEY) ?? "null")).toEqual([
    { enabled: "volume" },
  ]);
});

// Exercise several explicit visibility changes in one event.
function TurnEveryAppOn() {
  const { definition, setEnabled } = useSystemTray();
  return (
    <button
      onClick={() => {
        for (const id of definition.order) {
          setEnabled(id, true);
        }
      }}
      type="button"
    >
      Turn every app on
    </button>
  );
}

test("turning several apps back on in one event keeps every change", () => {
  localStorage.setItem(TRAY_KEY, JSON.stringify(["clock", "volume"]));
  const view = render(
    <>
      <SystemTray />
      <TurnEveryAppOn />
    </>,
    { wrapper: Providers },
  );
  expect(trayControls(view.container)).toEqual([]);

  fireEvent.click(view.getByRole("button", { name: "Turn every app on" }));

  expect(trayControls(view.container)).toEqual(["Volume", "12:00"]);
  expect(JSON.parse(localStorage.getItem(TRAY_KEY) ?? "null")).toEqual([
    { enabled: "clock" },
    { enabled: "volume" },
  ]);
});

test("opt-in apps respect saved choices alongside legacy disabled ids", () => {
  const definition = {
    ...TRAY,
    apps: {
      ...TRAY.apps,
      clock: { ...TRAY.apps.clock, defaultEnabled: false },
    },
  };
  const ui = (
    <SystemTrayProvider definition={definition} storageKey={TRAY_KEY}>
      <SystemTray />
      <DisplayProperties />
    </SystemTrayProvider>
  );
  localStorage.setItem(TRAY_KEY, JSON.stringify(["volume"]));
  const view = render(ui);
  expect(trayControls(view.container)).toEqual([]);
  fireEvent.click(view.getByRole("switch", { name: "Clock" }));
  view.unmount();
  expect(trayControls(render(ui).container)).toEqual(["12:00"]);
});

test("unreadable storage leaves every app on", () => {
  localStorage.setItem(TRAY_KEY, "{not json");
  const view = render(<SystemTray />, { wrapper: Providers });
  expect(trayControls(view.container)).toEqual(["Volume", "12:00"]);
});

// A tray app whose popover, like a real one, renders into the body.
function PopoverApp() {
  return (
    <>
      <button type="button">Status</button>
      {createPortal(<button type="button">Popover link</button>, document.body)}
    </>
  );
}

const POPOVER_TRAY: SystemTrayDefinition<"status"> = {
  apps: { status: { component: PopoverApp, title: "Status" } },
  order: ["status"],
};

test("a right-click or long press in an app's portaled popover opens no tray menu", async () => {
  const view = render(
    <SystemTrayProvider definition={POPOVER_TRAY} storageKey={TRAY_KEY}>
      <SystemTray />
    </SystemTrayProvider>,
  );
  const link = view.getByRole("button", { name: "Popover link" });

  fireEvent.contextMenu(link, { clientX: 10, clientY: 10 });
  fireEvent.pointerDown(link, {
    clientX: 10,
    clientY: 10,
    pointerType: "touch",
  });
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 550);
    await promise;
  });
  expect(view.queryByRole("button", { name: "Disable Status" })).toBeNull();

  fireEvent.contextMenu(view.getByRole("button", { name: "Status" }), {
    clientX: 10,
    clientY: 10,
  });
  expect(view.getByRole("button", { name: "Disable Status" })).toBeDefined();
});

// A tray app with a real popover: a windowing Menu that closes on an outside
// press, as the Sync Status popover does.
function StatusPopoverApp() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Status
      </button>
      {open && (
        <Menu onClose={() => setOpen(false)} position={{ x: 0, y: 0 }}>
          <p>Status detail</p>
        </Menu>
      )}
    </>
  );
}

const TWO_APP_TRAY: SystemTrayDefinition<"status" | "volume"> = {
  apps: {
    status: { component: StatusPopoverApp, title: "Status" },
    volume: { component: VolumeApp, title: "Volume" },
  },
  order: ["status", "volume"],
};

test("a long press on one app closes another app's open popover before the tray menu opens", async () => {
  const view = render(
    <SystemTrayProvider definition={TWO_APP_TRAY} storageKey={TRAY_KEY}>
      <SystemTray />
    </SystemTrayProvider>,
  );
  const menuTexts = () =>
    Array.from(document.querySelectorAll(".menu"), (menu) => menu.textContent);

  fireEvent.click(view.getByRole("button", { name: "Status" }));
  expect(menuTexts()).toEqual(["Status detail"]);

  fireEvent.pointerDown(view.getByRole("button", { name: "Volume" }), {
    clientX: 10,
    clientY: 10,
    pointerType: "touch",
  });
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 550);
    await promise;
  });
  expect(menuTexts()).toEqual(["Disable Volume"]);
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

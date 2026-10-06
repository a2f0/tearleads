import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useMemo } from "react";
import {
  useWindowBackAction,
  WindowMenuProvider,
} from "../window/WindowMenuContext";
import { WindowTitleBar } from "../window/WindowTitleBar";
import { WindowToolBar } from "../window/WindowToolBar";
import { WindowingIconsProvider } from "./WindowingIcons";
import type { WindowingIcon, WindowingIconProps } from "./windowingIcon";

afterEach(() => cleanup());

function namedIcon(name: string): WindowingIcon {
  return function NamedIcon({ className, size }: WindowingIconProps) {
    return <svg className={className} data-icon={name} width={size} />;
  };
}

const HostBack = namedIcon("host-back");
const HostUp = namedIcon("host-up");
const HostDown = namedIcon("host-down");

function BackActionSource() {
  const action = useMemo(() => ({ label: "Back", onClick: () => {} }), []);
  useWindowBackAction(action);
  return null;
}

function TitleBar() {
  return (
    <WindowTitleBar
      title="Notes"
      onPointerDown={() => {}}
      onMinimize={() => {}}
      onMaximize={() => {}}
      onClose={() => {}}
      onMoveForward={() => {}}
      onMoveBackward={() => {}}
    />
  );
}

function openTitleBarMenu(view: ReturnType<typeof render>) {
  fireEvent.contextMenu(
    view.getByRole("toolbar", { name: "Window controls" }),
    {
      clientX: 100,
      clientY: 120,
    },
  );
}

function menuIcon(view: ReturnType<typeof render>, label: string) {
  return view.getByRole("button", { name: label }).querySelector("svg");
}

test("draws the chrome with Phosphor icons by default", () => {
  const view = render(
    <WindowMenuProvider>
      <BackActionSource />
      <WindowToolBar />
      <TitleBar />
    </WindowMenuProvider>,
  );
  openTitleBarMenu(view);

  const back = view.getByRole("button", { name: "Back" }).querySelector("svg");
  expect(back?.getAttribute("data-icon")).toBeNull();
  expect(back?.getAttribute("width")).toBe("18");
  expect(menuIcon(view, "Move Forward")?.getAttribute("data-icon")).toBeNull();
});

test("draws the chrome with a host's icons", () => {
  const view = render(
    <WindowingIconsProvider
      icons={{ back: HostBack, moveBackward: HostDown, moveForward: HostUp }}
    >
      <WindowMenuProvider>
        <BackActionSource />
        <WindowToolBar />
        <TitleBar />
      </WindowMenuProvider>
    </WindowingIconsProvider>,
  );
  openTitleBarMenu(view);

  const back = view.getByRole("button", { name: "Back" }).querySelector("svg");
  expect(back?.getAttribute("data-icon")).toBe("host-back");
  expect(back?.getAttribute("width")).toBe("18");
  expect(menuIcon(view, "Move Forward")?.getAttribute("data-icon")).toBe(
    "host-up",
  );
  expect(menuIcon(view, "Move Backward")?.getAttribute("data-icon")).toBe(
    "host-down",
  );
});

test("keeps the icons a nested provider leaves out", () => {
  const view = render(
    <WindowingIconsProvider icons={{ back: HostBack, moveForward: HostUp }}>
      <WindowingIconsProvider icons={{ moveForward: namedIcon("inner-up") }}>
        <WindowMenuProvider>
          <BackActionSource />
          <WindowToolBar />
          <TitleBar />
        </WindowMenuProvider>
      </WindowingIconsProvider>
    </WindowingIconsProvider>,
  );
  openTitleBarMenu(view);

  expect(
    view
      .getByRole("button", { name: "Back" })
      .querySelector("svg")
      ?.getAttribute("data-icon"),
  ).toBe("host-back");
  expect(menuIcon(view, "Move Forward")?.getAttribute("data-icon")).toBe(
    "inner-up",
  );
  expect(menuIcon(view, "Move Backward")?.getAttribute("data-icon")).toBeNull();
});

import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { MiniAppSelectMenu } from "../mini-app/controls/MiniAppSelectMenu";
import { Menu } from "./Menu";
import { MenuItem } from "./MenuItem";

afterEach(cleanup);

function MenuHarness() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open menu
      </button>
      <button type="button">Outside</button>
      <output>{selected}</output>
      {open && (
        <Menu position={{ x: 24, y: 48 }} onClose={() => setOpen(false)}>
          <MenuItem label="Unavailable" disabled onClick={() => {}} />
          <MenuItem
            label="First"
            onClick={() => {
              setSelected("First selected");
              setOpen(false);
            }}
          />
          <MenuItem label="Skipped" disabled onClick={() => {}} />
          <MenuItem
            label="Last"
            onClick={() => {
              setSelected("Last selected");
              setOpen(false);
            }}
          />
        </Menu>
      )}
    </>
  );
}

function openMenu() {
  const view = render(<MenuHarness />);
  const trigger = view.getByRole("button", { name: "Open menu" });
  trigger.focus();
  fireEvent.click(trigger);
  return { ...view, trigger };
}

test("focuses enabled actions and navigates with wrapping, Home and End", () => {
  const view = openMenu();
  const first = view.getByRole("button", { name: "First" });
  const last = view.getByRole("button", { name: "Last" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "ArrowUp" });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "ArrowDown" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "Home" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "End" });
  expect(document.activeElement).toBe(last);
});

test("Escape closes the menu, restores its trigger and stays out of parent shortcuts", () => {
  const view = openMenu();
  let bubbled = false;
  const parentShortcut = () => {
    bubbled = true;
  };
  document.addEventListener("keydown", parentShortcut);
  try {
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(view.queryByRole("button", { name: "First" })).toBeNull();
    expect(document.activeElement).toBe(view.trigger);
    expect(bubbled).toBe(false);
  } finally {
    document.removeEventListener("keydown", parentShortcut);
  }
});

test("Tab dismisses without preventing the browser's next focus step", () => {
  const view = openMenu();
  const allowed = fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Tab",
  });
  expect(allowed).toBe(true);
  expect(view.queryByRole("button", { name: "First" })).toBeNull();
  expect(document.activeElement).toBe(view.trigger);
});

test("selecting an action restores focus after the portal unmounts", () => {
  const view = openMenu();
  fireEvent.click(view.getByRole("button", { name: "First" }));
  expect(view.getByText("First selected")).toBeTruthy();
  expect(document.activeElement).toBe(view.trigger);
});

test("dismissal preserves focus that moved outside the menu", () => {
  const view = openMenu();
  const outside = view.getByRole("button", { name: "Outside" });
  outside.focus();
  fireEvent.mouseDown(outside);
  expect(view.queryByRole("button", { name: "First" })).toBeNull();
  expect(document.activeElement).toBe(outside);
});

test("a portaled combobox retains its selected highlight and trigger focus", () => {
  const view = render(
    <MiniAppSelectMenu
      ariaLabel="Pick a view"
      onChange={() => {}}
      portaled
      options={[
        { id: "first", label: "First option" },
        { id: "last", label: "Last option" },
      ]}
      value="last"
    />,
  );
  const trigger = view.getByRole("combobox", { name: "Pick a view" });
  trigger.focus();
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute("aria-activedescendant")).toBe(
    view.getByRole("option", { name: "Last option" }).id,
  );
  fireEvent.keyDown(trigger, { key: "ArrowUp" });
  expect(trigger.getAttribute("aria-activedescendant")).toBe(
    view.getByRole("option", { name: "First option" }).id,
  );
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(view.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test("checkbox-only menus focus and navigate their controls without swallowing Space", () => {
  let toggled = false;
  const view = render(
    <Menu position={{ x: 24, y: 48 }} onClose={() => {}}>
      <input
        type="checkbox"
        aria-label="Name column"
        onChange={() => {
          toggled = true;
        }}
      />
      <input type="checkbox" aria-label="Disabled column" disabled />
      <input type="checkbox" aria-label="Date column" />
    </Menu>,
  );
  const name = view.getByRole("checkbox", { name: "Name column" });
  const date = view.getByRole("checkbox", { name: "Date column" });
  expect(document.activeElement).toBe(name);
  fireEvent.keyDown(name, { key: "ArrowDown" });
  expect(document.activeElement).toBe(date);
  fireEvent.keyDown(date, { key: "Home" });
  expect(document.activeElement).toBe(name);
  expect(fireEvent.keyDown(name, { key: " " })).toBe(true);
  fireEvent.click(name);
  expect(toggled).toBe(true);
});

test("Escape outside the menu and modified arrows remain available to other controls", () => {
  const view = openMenu();
  const first = view.getByRole("button", { name: "First" });
  expect(fireEvent.keyDown(first, { key: "ArrowDown", altKey: true })).toBe(
    true,
  );
  expect(document.activeElement).toBe(first);
  const outside = view.getByRole("button", { name: "Outside" });
  outside.focus();
  expect(fireEvent.keyDown(outside, { key: "Escape" })).toBe(true);
  expect(view.getByRole("button", { name: "First" })).toBeTruthy();
  expect(document.activeElement).toBe(outside);
});

test("an all-disabled menu can still be dismissed with Escape", () => {
  let closed = false;
  render(
    <Menu
      position={{ x: 24, y: 48 }}
      onClose={() => {
        closed = true;
      }}
    >
      <MenuItem label="Unavailable" disabled onClick={() => {}} />
    </Menu>,
  );
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  expect(closed).toBe(true);
});

test("clicking a non-focusable surface dismisses without restoring the launcher", () => {
  const view = openMenu();
  fireEvent.mouseDown(document.body);
  expect(view.queryByRole("button", { name: "First" })).toBeNull();
  expect(document.activeElement).not.toBe(view.trigger);
});

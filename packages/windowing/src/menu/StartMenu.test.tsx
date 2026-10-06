import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { WindowingIconProps } from "../icons/windowingIcon";
import { Menu, type MenuPosition } from "./Menu";
import { MenuItem } from "./MenuItem";
import { StartMenu, type StartMenuItem } from "./StartMenu";

afterEach(() => cleanup());

function NotesIcon({ className, size }: WindowingIconProps) {
  return <svg className={className} data-icon="notes" width={size} />;
}

function startButton(view: ReturnType<typeof render>) {
  return view.getByRole("button", { name: "Menu" });
}

// The button's top-left corner, where the menu opens.
function placeButton(button: HTMLElement) {
  button.getBoundingClientRect = () => DOMRect.fromRect({ x: 4, y: 560 });
}

test("opens its items above the button and runs the chosen one", () => {
  const chosen: MenuPosition[] = [];
  const items: StartMenuItem[] = [
    {
      icon: NotesIcon,
      id: "notes",
      label: "Notes",
      onSelect: (position) => chosen.push(position),
    },
    { disabled: true, id: "mail", label: "Mail", onSelect: () => {} },
  ];
  const view = render(<StartMenu icon="★" items={items} />);
  const button = startButton(view);
  placeButton(button);

  expect(button.className).toBe("start-menu-button");
  expect(button.getAttribute("aria-haspopup")).toBe("menu");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(view.queryByText("Notes")).toBeNull();

  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  const notes = view.getByRole("button", { name: "Notes" });
  const icon = notes.querySelector("svg[data-icon='notes']");
  expect(icon?.getAttribute("class")).toBe("menu-item-icon");
  expect(icon?.getAttribute("width")).toBe("16");
  expect(view.getByRole("button", { name: "Mail" })).toHaveProperty(
    "disabled",
    true,
  );

  fireEvent.click(notes);
  expect(chosen).toEqual([{ x: 4, y: 560 }]);
  expect(view.queryByText("Notes")).toBeNull();
  expect(button.getAttribute("aria-expanded")).toBe("false");
});

test("takes a label, and the host's classes in place of its own", () => {
  const view = render(
    <StartMenu className="host-button" icon="★" label="Start" items={[]} />,
  );

  expect(view.getByRole("button", { name: "Start" }).className).toBe(
    "host-button",
  );
});

test("renders the host's own menu in place of items", () => {
  const view = render(
    <StartMenu
      icon="★"
      items={[{ id: "ignored", label: "Ignored", onSelect: () => {} }]}
      renderMenu={({ close, position }) => (
        <Menu position={position} onClose={close}>
          <MenuItem
            label={`Lock at ${position.x},${position.y}`}
            onClick={close}
          />
        </Menu>
      )}
    />,
  );
  const button = startButton(view);
  placeButton(button);

  fireEvent.click(button);
  expect(view.queryByText("Ignored")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Lock at 4,560" }));
  expect(view.queryByText("Lock at 4,560")).toBeNull();
  expect(button.getAttribute("aria-expanded")).toBe("false");
});

import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MiniAppSelectMenu } from "./MiniAppSelectMenu";

afterEach(cleanup);

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

test("arrow keys move from a highlighted option whose id is empty", () => {
  const view = render(
    <MiniAppSelectMenu
      ariaLabel="Pick a residency"
      onChange={() => {}}
      portaled
      options={[
        { id: "", label: "None" },
        { id: "first", label: "First option" },
        { id: "last", label: "Last option" },
      ]}
      value="last"
    />,
  );
  const trigger = view.getByRole("combobox", { name: "Pick a residency" });
  const highlighted = () =>
    view
      .getAllByRole("option")
      .find(
        (option) => option.id === trigger.getAttribute("aria-activedescendant"),
      )?.textContent;
  fireEvent.click(trigger);

  fireEvent.keyDown(trigger, { key: "Home" });
  expect(highlighted()).toBe("None");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(highlighted()).toBe("First option");
  fireEvent.keyDown(trigger, { key: "ArrowUp" });
  expect(highlighted()).toBe("None");
  fireEvent.keyDown(trigger, { key: "ArrowUp" });
  expect(highlighted()).toBe("Last option");
});

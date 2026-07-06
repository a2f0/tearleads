import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { ExplorerTargetSelect } from "./ExplorerTargetSelect";

afterEach(() => cleanup());

const targetOptions = [
  { id: "archive-container", icon: "folder", label: "Archive" },
  { id: "trash-container", icon: "trash", label: "Trash" },
];

test("explorer target select renders folder icons in the trigger and dropdown", () => {
  const changes: string[] = [];
  const selectRef = createRef<HTMLButtonElement>();
  const view = render(
    <ExplorerTargetSelect
      ariaLabel="Destination container"
      disabled={false}
      onChange={(value) => changes.push(value)}
      options={targetOptions}
      selectRef={selectRef}
      value="archive-container"
    />,
  );

  const trigger = view.getByRole("combobox", {
    name: "Destination container",
  });
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new Error("Expected destination trigger button.");
  }
  expect(selectRef.current).toBe(trigger);
  expect(
    trigger
      .querySelector(".mini-app-select-menu-icon")
      ?.getAttribute("data-icon"),
  ).toBe("folder");

  fireEvent.click(trigger);

  const trashOption = view.getByRole("option", { name: "Trash" });
  expect(trashOption.getAttribute("tabindex")).toBe("-1");
  expect(
    trashOption
      .querySelector(".mini-app-select-menu-icon")
      ?.getAttribute("data-container-icon"),
  ).toBe("trash");
  expect(
    trashOption
      .querySelector(".mini-app-select-menu-icon")
      ?.getAttribute("data-icon"),
  ).toBe("trash");

  fireEvent.click(trashOption);

  expect(changes).toEqual(["trash-container"]);
  expect(view.queryByRole("listbox")).toBeNull();
});

test("explorer target select scrolls keyboard-highlighted options into view", () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const scrollCalls: Array<boolean | ScrollIntoViewOptions | undefined> = [];
  HTMLElement.prototype.scrollIntoView = (
    options?: boolean | ScrollIntoViewOptions,
  ) => {
    scrollCalls.push(options);
  };

  try {
    const view = render(
      <ExplorerTargetSelect
        ariaLabel="Destination container"
        disabled={false}
        onChange={() => undefined}
        options={targetOptions}
        selectRef={createRef<HTMLButtonElement>()}
        value="archive-container"
      />,
    );

    const trigger = view.getByRole("combobox", {
      name: "Destination container",
    });
    fireEvent.click(trigger);

    scrollCalls.length = 0;
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    expect(scrollCalls).toContainEqual({ block: "nearest" });
  } finally {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  }
});

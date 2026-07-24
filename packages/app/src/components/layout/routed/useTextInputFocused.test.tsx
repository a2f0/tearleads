import { expect, test } from "bun:test";
import { act, fireEvent, render } from "@testing-library/react";
import { useTextInputFocused } from "./useTextInputFocused";

function FocusState() {
  return <output>{String(useTextInputFocused(true))}</output>;
}

test("tracks controls that can summon a software keyboard", () => {
  const view = render(<FocusState />);
  const controls = [
    document.createElement("textarea"),
    Object.assign(document.createElement("div"), { contentEditable: "true" }),
  ];

  for (const control of controls) {
    view.container.append(control);
    fireEvent.focusIn(control);
    expect(view.getByText("true")).toBeTruthy();
    fireEvent.focusOut(control);
    expect(view.getByText("false")).toBeTruthy();
  }
});

test("ignores controls that do not summon a software keyboard", () => {
  const view = render(<FocusState />);
  const readonlyInput = document.createElement("input");
  readonlyInput.readOnly = true;
  const disabledTextarea = document.createElement("textarea");
  disabledTextarea.disabled = true;
  const nonEditable = document.createElement("div");
  nonEditable.contentEditable = "false";

  for (const control of [readonlyInput, disabledTextarea, nonEditable]) {
    view.container.append(control);
    fireEvent.focusIn(control);
    expect(view.getByText("false")).toBeTruthy();
  }
});

test("recovers when a focused input is removed without a focusout event", () => {
  const view = render(<FocusState />);
  const input = document.createElement("input");
  view.container.append(input);
  act(() => input.focus());
  expect(view.getByText("true")).toBeTruthy();

  act(() => {
    input.remove();
    window.dispatchEvent(new Event("resize"));
  });
  expect(view.getByText("false")).toBeTruthy();
});

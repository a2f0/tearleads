import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  useWindowActions,
  useWindowStateData,
  WindowStateProvider,
} from "../../window/WindowStateProvider";
import { PaneFooter } from "./PaneFooter";

afterEach(cleanup);

function WindowControls() {
  const { windows } = useWindowStateData();
  const { create, minimize } = useWindowActions();
  const notes = windows.find((windowEntry) => windowEntry.title === "Notes");

  return (
    <>
      <button
        type="button"
        onClick={() => create("Notes", 0, 0, undefined, { appId: "notes" })}
      >
        Open Notes
      </button>
      <button type="button" onClick={() => notes && minimize(notes.id)}>
        Minimize Notes
      </button>
      <output data-testid="notes-state">
        {notes?.minimized ? "minimized" : "visible"}
      </output>
    </>
  );
}

function renderFooter() {
  return render(
    <WindowStateProvider>
      <WindowControls />
      <PaneFooter />
    </WindowStateProvider>,
  );
}

test("shows visible open mini-apps in the taskbar", () => {
  const view = renderFooter();

  fireEvent.click(view.getByRole("button", { name: "Open Notes" }));

  expect(
    view.getByRole("button", { name: "Activate Notes window" }),
  ).toBeTruthy();
  expect(view.getByTestId("notes-state").textContent).toBe("visible");
});

test("keeps minimized mini-apps in the taskbar and restores them", () => {
  const view = renderFooter();

  fireEvent.click(view.getByRole("button", { name: "Open Notes" }));
  fireEvent.click(view.getByRole("button", { name: "Minimize Notes" }));

  expect(view.getByTestId("notes-state").textContent).toBe("minimized");
  fireEvent.click(view.getByRole("button", { name: "Activate Notes window" }));
  expect(view.getByTestId("notes-state").textContent).toBe("visible");
});

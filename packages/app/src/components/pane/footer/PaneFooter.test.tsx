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
      <button type="button" onClick={() => create("Contacts", 0, 0)}>
        Open Contacts
      </button>
      <output data-testid="notes-state">
        {notes === undefined
          ? "closed"
          : notes.minimized
            ? "minimized"
            : notes.maximized
              ? "maximized"
              : "visible"}
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

function openNotes(view: ReturnType<typeof renderFooter>) {
  fireEvent.click(view.getByRole("button", { name: "Open Notes" }));
  return view.getByRole("button", { name: "Activate Notes window" });
}

test("shows visible open mini-apps in the taskbar", () => {
  const view = renderFooter();

  expect(openNotes(view)).toBeTruthy();
  expect(view.getByTestId("notes-state").textContent).toBe("visible");
});

test("labels taskbar entries whether or not they are minimized", () => {
  const view = renderFooter();
  const taskbarButton = openNotes(view);

  expect(taskbarButton.textContent).toBe("Notes");

  fireEvent.click(view.getByRole("button", { name: "Minimize Notes" }));

  expect(taskbarButton.textContent).toBe("Notes");
});

test("keeps minimized mini-apps in the taskbar and restores them", () => {
  const view = renderFooter();
  const taskbarButton = openNotes(view);

  fireEvent.click(view.getByRole("button", { name: "Minimize Notes" }));

  expect(view.getByTestId("notes-state").textContent).toBe("minimized");
  fireEvent.click(taskbarButton);
  expect(view.getByTestId("notes-state").textContent).toBe("visible");
});

test("marks only the frontmost visible window active across minimize and restore", () => {
  const view = renderFooter();
  const notes = openNotes(view);
  expect(notes.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(view.getByRole("button", { name: "Open Contacts" }));
  const contacts = view.getByRole("button", {
    name: "Activate Contacts window",
  });
  expect(notes.getAttribute("aria-pressed")).toBe("false");
  expect(contacts.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(notes);
  expect(notes.getAttribute("aria-pressed")).toBe("true");
  expect(contacts.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(view.getByRole("button", { name: "Minimize Notes" }));
  expect(notes.getAttribute("aria-pressed")).toBe("false");
  expect(contacts.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(notes);
  expect(notes.getAttribute("aria-pressed")).toBe("true");
});

test("taskbar context menu minimizes a visible window", () => {
  const view = renderFooter();
  const taskbarButton = openNotes(view);

  fireEvent.contextMenu(taskbarButton);
  expect(view.queryByRole("button", { name: "Restore" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Minimize" }));

  expect(view.getByTestId("notes-state").textContent).toBe("minimized");
  expect(view.queryByRole("button", { name: "Minimize" })).toBeNull();
});

test("taskbar context menu restores a minimized window", () => {
  const view = renderFooter();
  const taskbarButton = openNotes(view);

  fireEvent.click(view.getByRole("button", { name: "Minimize Notes" }));
  fireEvent.contextMenu(taskbarButton);
  fireEvent.click(view.getByRole("button", { name: "Restore" }));

  expect(view.getByTestId("notes-state").textContent).toBe("visible");
});

test("taskbar context menu maximizes a minimized window", () => {
  const view = renderFooter();
  const taskbarButton = openNotes(view);

  fireEvent.click(view.getByRole("button", { name: "Minimize Notes" }));
  fireEvent.contextMenu(taskbarButton);
  fireEvent.click(view.getByRole("button", { name: "Maximize" }));

  expect(view.getByTestId("notes-state").textContent).toBe("maximized");
});

test("taskbar context menu closes a window", () => {
  const view = renderFooter();
  const taskbarButton = openNotes(view);

  fireEvent.contextMenu(taskbarButton);
  fireEvent.click(view.getByRole("button", { name: "Close" }));

  expect(view.getByTestId("notes-state").textContent).toBe("closed");
  expect(
    view.queryByRole("button", { name: "Activate Notes window" }),
  ).toBeNull();
});

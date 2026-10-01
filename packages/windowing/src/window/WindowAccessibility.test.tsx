import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { type ComponentType, useEffect, useRef } from "react";
import { stubLayout } from "./layout.testUtils";
import { Window } from "./Window";
import {
  useWindowActions,
  useWindowStateData,
  type WindowCreateOptions,
  WindowStateProvider,
} from "./WindowStateProvider";

afterEach(cleanup);

function PlainContent() {
  return <p>notes</p>;
}

function SelfFocusingContent() {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);
  return <input aria-label="Note title" ref={field} />;
}

function Desktop({
  content,
  options,
}: {
  content: ComponentType;
  options: WindowCreateOptions;
}) {
  const { windows } = useWindowStateData();
  const { create, minimize, restore } = useWindowActions();
  const first = windows[0];

  return (
    <>
      <button
        type="button"
        onClick={() => create("Notes", 0, 0, content, options)}
      >
        Open notes
      </button>
      <button type="button" onClick={() => first && minimize(first.id)}>
        Minimize notes
      </button>
      <button type="button" onClick={() => first && restore(first.id)}>
        Restore notes
      </button>
      <output aria-label="committed geometry">
        {first
          ? JSON.stringify({ position: first.position, size: first.size })
          : ""}
      </output>
      <div data-testid="surface">
        {windows.map((entry) => (
          <Window key={entry.id} windowId={entry.id} />
        ))}
      </div>
    </>
  );
}

function openNotes(
  content: ComponentType = PlainContent,
  options: WindowCreateOptions = {},
) {
  const view = render(
    <WindowStateProvider>
      <Desktop content={content} options={options} />
    </WindowStateProvider>,
  );
  stubLayout(view.getByTestId("surface"), {
    clientHeight: 600,
    clientWidth: 800,
  });
  fireEvent.click(view.getByRole("button", { name: "Open notes" }));
  const dialog = view.getByRole("dialog", { name: "Notes" });
  return { dialog, view };
}

function committedGeometry(view: ReturnType<typeof render>) {
  return JSON.parse(
    view.getByRole("status", { name: "committed geometry" }).textContent ??
      "{}",
  ) as { position?: object; size?: object };
}

function chooseViewMenuItem(dialog: HTMLElement, label: string) {
  fireEvent.click(within(dialog).getByRole("menuitem", { name: "View" }));
  fireEvent.click(within(dialog).getByRole("menuitem", { name: label }));
}

test("each window is a dialog labelled by its title", () => {
  const { dialog } = openNotes();

  expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
  expect(dialog.getAttribute("aria-modal")).toBeNull();
});

test("opening a window moves focus into it", () => {
  const { dialog } = openNotes();

  expect(document.activeElement).toBe(dialog);
});

test("a field the window focuses itself keeps focus", () => {
  const { view } = openNotes(SelfFocusingContent);

  expect(document.activeElement).toBe(
    view.getByRole("textbox", { name: "Note title" }),
  );
});

test("restoring a minimized window focuses it again", () => {
  const { view } = openNotes();
  const minimizeButton = view.getByRole("button", { name: "Minimize notes" });
  const restoreButton = view.getByRole("button", { name: "Restore notes" });

  minimizeButton.focus();
  fireEvent.click(minimizeButton);
  expect(view.queryByRole("dialog", { name: "Notes" })).toBeNull();

  restoreButton.focus();
  fireEvent.click(restoreButton);

  expect(document.activeElement).toBe(
    view.getByRole("dialog", { name: "Notes" }),
  );
});

test("View > Move Window moves with arrow keys and Enter keeps the move", () => {
  const { dialog, view } = openNotes();
  stubLayout(dialog, { offsetHeight: 100, offsetWidth: 200 });

  chooseViewMenuItem(dialog, "Move Window");
  expect(within(dialog).getByRole("status").textContent).toContain(
    "Moving window",
  );

  fireEvent.keyDown(document, { key: "ArrowRight" });
  fireEvent.keyDown(document, { key: "ArrowRight" });
  fireEvent.keyDown(document, { key: "ArrowDown" });

  expect(dialog.style.left).toBe("20px");
  expect(dialog.style.top).toBe("10px");
  expect(committedGeometry(view).position).toEqual({ x: 0, y: 0 });

  act(() => {
    fireEvent.keyDown(document, { key: "Enter" });
  });

  expect(committedGeometry(view).position).toEqual({ x: 20, y: 10 });

  fireEvent.keyDown(document, { key: "ArrowRight" });
  expect(dialog.style.left).toBe("20px");
});

test("Escape cancels a keyboard resize", () => {
  const { dialog, view } = openNotes(PlainContent, {
    size: { height: 200, width: 300 },
  });

  chooseViewMenuItem(dialog, "Resize Window");
  fireEvent.keyDown(document, { key: "ArrowRight" });
  fireEvent.keyDown(document, { key: "ArrowDown" });

  expect(dialog.style.width).toBe("310px");
  expect(dialog.style.height).toBe("210px");

  act(() => {
    fireEvent.keyDown(document, { key: "Escape" });
  });

  expect(dialog.style.width).toBe("300px");
  expect(dialog.style.height).toBe("200px");
  expect(committedGeometry(view).size).toEqual({ height: 200, width: 300 });
});

test("focus waits until the window is laid out and visible", () => {
  const focusedVisibilities: string[] = [];
  const originalFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function focusAndRecord(options) {
    if (this.getAttribute("role") === "dialog") {
      focusedVisibilities.push(this.style.visibility);
    }
    originalFocus.call(this, options);
  };
  try {
    openNotes();
  } finally {
    HTMLElement.prototype.focus = originalFocus;
  }

  expect(focusedVisibilities).toEqual([""]);
});

test("minimizing during a keyboard move hands the arrow keys back", () => {
  const { dialog, view } = openNotes();

  chooseViewMenuItem(dialog, "Move Window");
  fireEvent.click(view.getByRole("button", { name: "Minimize notes" }));

  expect(fireEvent.keyDown(document, { key: "ArrowRight" })).toBe(true);
});

test("a pointer press ends a keyboard move and keeps it", () => {
  const { dialog, view } = openNotes();
  stubLayout(dialog, { offsetHeight: 100, offsetWidth: 200 });

  chooseViewMenuItem(dialog, "Move Window");
  fireEvent.keyDown(document, { key: "ArrowRight" });
  act(() => {
    fireEvent.pointerDown(document.body);
  });

  expect(committedGeometry(view).position).toEqual({ x: 10, y: 0 });
  expect(fireEvent.keyDown(document, { key: "ArrowRight" })).toBe(true);
});

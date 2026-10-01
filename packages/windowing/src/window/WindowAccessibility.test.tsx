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
  const region = view.getByRole("region", { name: "Notes" });
  return { region, view };
}

function committedGeometry(view: ReturnType<typeof render>) {
  return JSON.parse(
    view.getByRole("status", { name: "committed geometry" }).textContent ??
      "{}",
  ) as { position?: object; size?: object };
}

function chooseViewMenuItem(region: HTMLElement, label: string) {
  fireEvent.click(within(region).getByRole("menuitem", { name: "View" }));
  fireEvent.click(within(region).getByRole("menuitem", { name: label }));
}

test("each window is a region labelled by its title", () => {
  const { region } = openNotes();

  expect(region.getAttribute("aria-labelledby")).toBeTruthy();
  expect(region.getAttribute("aria-modal")).toBeNull();
});

test("opening a window moves focus into it", () => {
  const { region } = openNotes();

  expect(document.activeElement).toBe(region);
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
  expect(view.queryByRole("region", { name: "Notes" })).toBeNull();

  restoreButton.focus();
  fireEvent.click(restoreButton);

  expect(document.activeElement).toBe(
    view.getByRole("region", { name: "Notes" }),
  );
});

test("View > Move Window moves with arrow keys and Enter keeps the move", () => {
  const { region, view } = openNotes();
  stubLayout(region, { offsetHeight: 100, offsetWidth: 200 });

  chooseViewMenuItem(region, "Move Window");
  expect(within(region).getByRole("status").textContent).toContain(
    "Moving window",
  );

  fireEvent.keyDown(document, { key: "ArrowRight" });
  fireEvent.keyDown(document, { key: "ArrowRight" });
  fireEvent.keyDown(document, { key: "ArrowDown" });

  expect(region.style.left).toBe("20px");
  expect(region.style.top).toBe("10px");
  expect(committedGeometry(view).position).toEqual({ x: 0, y: 0 });

  act(() => {
    fireEvent.keyDown(document, { key: "Enter" });
  });

  expect(committedGeometry(view).position).toEqual({ x: 20, y: 10 });

  fireEvent.keyDown(document, { key: "ArrowRight" });
  expect(region.style.left).toBe("20px");
});

test("Escape cancels a keyboard resize", () => {
  const { region, view } = openNotes(PlainContent, {
    size: { height: 200, width: 300 },
  });

  chooseViewMenuItem(region, "Resize Window");
  fireEvent.keyDown(document, { key: "ArrowRight" });
  fireEvent.keyDown(document, { key: "ArrowDown" });

  expect(region.style.width).toBe("310px");
  expect(region.style.height).toBe("210px");

  act(() => {
    fireEvent.keyDown(document, { key: "Escape" });
  });

  expect(region.style.width).toBe("300px");
  expect(region.style.height).toBe("200px");
  expect(committedGeometry(view).size).toEqual({ height: 200, width: 300 });
});

test("focus waits until the window is laid out and visible", () => {
  const focusedVisibilities: string[] = [];
  const originalFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function focusAndRecord(options) {
    if (this.classList.contains("window")) {
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
  const { region, view } = openNotes();

  chooseViewMenuItem(region, "Move Window");
  fireEvent.click(view.getByRole("button", { name: "Minimize notes" }));

  expect(fireEvent.keyDown(document, { key: "ArrowRight" })).toBe(true);
});

test("a pointer press ends a keyboard move and keeps it", () => {
  const { region, view } = openNotes();
  stubLayout(region, { offsetHeight: 100, offsetWidth: 200 });

  chooseViewMenuItem(region, "Move Window");
  fireEvent.keyDown(document, { key: "ArrowRight" });
  act(() => {
    fireEvent.pointerDown(document.body);
  });

  expect(committedGeometry(view).position).toEqual({ x: 10, y: 0 });
  expect(fireEvent.keyDown(document, { key: "ArrowRight" })).toBe(true);
});

test("keyboard move instructions are announced with the status bar hidden", () => {
  const { region } = openNotes();

  chooseViewMenuItem(region, "Hide Status Bar");
  chooseViewMenuItem(region, "Move Window");

  const status = within(region).getByRole("status");
  expect(status.textContent).toContain("Moving window");
  expect(status.querySelector(".window-statusbar--hidden")).not.toBeNull();
});

test("a keyboard move ends when focus moves to another window", () => {
  const { region, view } = openNotes();
  stubLayout(region, { offsetHeight: 100, offsetWidth: 200 });
  fireEvent.click(view.getByRole("button", { name: "Open notes" }));
  const [first, second] = view.getAllByRole("region", { name: "Notes" });
  if (!first || !second) throw new Error("two windows not rendered");

  chooseViewMenuItem(first, "Move Window");
  expect(document.activeElement === first).toBe(true);

  act(() => {
    second.focus();
  });

  expect(fireEvent.keyDown(document, { key: "ArrowRight" })).toBe(true);
  expect(first.style.left).toBe("0px");
});

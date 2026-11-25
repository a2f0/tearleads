import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useMiniAppColumnWidths } from "./MiniAppColumnWidths";
import { MiniAppTable, type MiniAppTableColumn } from "./MiniAppTable";

const STORAGE_KEY = "test:column-widths";

/**
 * There is no layout here, so each heading reports the width its column would
 * be drawn at: the chosen one when its `<col>` carries pixels, otherwise the
 * `drawn-<px>` its class names.
 */
function mockHeadingWidths() {
  return spyOn(
    HTMLElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(function (this: HTMLElement) {
    const table = this.closest("table");
    const index = this instanceof HTMLTableCellElement ? this.cellIndex : -1;
    const col = table?.querySelectorAll("col")[index];
    const chosen = col?.style.width.endsWith("px")
      ? Number.parseFloat(col.style.width)
      : Number.NaN;
    const drawn = /drawn-(\d+)/.exec(this.className)?.[1];
    const width = Number.isNaN(chosen) ? Number(drawn ?? 0) : chosen;
    return new DOMRect(0, 0, width, 24);
  });
}

const COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  { className: "drawn-400", header: "Name", id: "name", resizeLabel: "Name" },
  {
    className: "drawn-128",
    header: "Type",
    id: "type",
    resizeLabel: "Type",
    width: "8rem",
  },
  {
    className: "drawn-176",
    header: "Modified",
    id: "modified",
    resizeLabel: "Modified",
    width: "11rem",
  },
  { className: "drawn-36", header: "Actions", id: "actions", width: "2.25rem" },
];

function ResizableTable({
  columns = COLUMNS,
  folded = false,
  storageKey = STORAGE_KEY,
}: {
  columns?: ReadonlyArray<MiniAppTableColumn>;
  folded?: boolean;
  storageKey?: string;
}) {
  const columnWidths = useMiniAppColumnWidths(storageKey);
  return (
    <MiniAppTable
      aria-label="Items"
      columns={columns}
      columnWidths={folded ? undefined : columnWidths}
      style={{ color: "red" }}
    />
  );
}

function colWidths(container: HTMLElement) {
  return [...container.querySelectorAll("col")].map((col) => col.style.width);
}

function storedWidths(storageKey = STORAGE_KEY): unknown {
  const stored = globalThis.localStorage.getItem(storageKey);
  return stored === null ? null : JSON.parse(stored);
}

function press(handle: HTMLElement, clientX: number, pointerId = 1) {
  fireEvent.pointerDown(handle, {
    button: 0,
    clientX,
    isPrimary: true,
    pointerId,
  });
}

/** Two presses that move nothing, then the double-click a browser reports. */
function doubleClick(handle: HTMLElement) {
  for (const pointerId of [1, 2]) {
    press(handle, 500, pointerId);
    fireEvent.pointerUp(handle, { pointerId });
  }
  fireEvent.doubleClick(handle);
}

let rects: ReturnType<typeof mockHeadingWidths>;

beforeEach(() => {
  rects = mockHeadingWidths();
});

afterEach(() => {
  cleanup();
  rects.mockRestore();
  globalThis.localStorage.clear();
  document.body.style.userSelect = "";
});

test("a table offers a handle on each edge two resizable columns share", () => {
  const view = render(<ResizableTable />);

  expect(
    view
      .getAllByRole("separator")
      .map((handle) => handle.getAttribute("aria-label")),
  ).toEqual([
    "Resize Name and Type columns",
    "Resize Type and Modified columns",
  ]);
  // The fill column takes the slack; the table holds the rest at their widths.
  expect(colWidths(view.container)).toEqual(["", "8rem", "11rem", "2.25rem"]);
  const table = view.getByRole("table");
  expect(table.style.minWidth).toBe("calc(3rem + 8rem + 11rem + 2.25rem)");
  expect(table.style.color).toBe("red");
  // A heading that holds a handle is still named by its own content alone.
  expect(
    view.getAllByRole("columnheader").map((heading) => heading.textContent),
  ).toEqual(["Name", "Type", "Modified", "Actions"]);
  for (const name of ["Name", "Type", "Modified", "Actions"]) {
    view.getByRole("columnheader", { name });
  }
});

test("a handle announces where its edge sits between the two columns", () => {
  const view = render(<ResizableTable />);
  const handle = view.getByRole("separator", {
    name: "Resize Type and Modified columns",
  });

  expect(handle.getAttribute("aria-orientation")).toBe("vertical");
  expect(handle.getAttribute("aria-valuemin")).toBe("48");
  expect(handle.getAttribute("aria-valuenow")).toBe("128");
  expect(handle.getAttribute("aria-valuemax")).toBe("256");
});

test("dragging a handle trades width between its columns and stores it on release", () => {
  const view = render(<ResizableTable />);
  const handle = view.getByRole("separator", {
    name: "Resize Type and Modified columns",
  });

  press(handle, 500);
  expect(document.body.style.userSelect).toBe("none");
  fireEvent.pointerMove(handle, { clientX: 540, pointerId: 1 });

  expect(colWidths(view.container)).toEqual(["", "168px", "136px", "2.25rem"]);
  expect(view.getByRole("table").style.minWidth).toBe(
    "calc(3rem + 168px + 136px + 2.25rem)",
  );
  expect(handle.className).toContain("mini-app-column-resize-handle--dragging");
  expect(handle.getAttribute("aria-valuenow")).toBe("168");
  // Nothing is stored until the pointer lets go.
  expect(storedWidths()).toBeNull();

  fireEvent.pointerUp(handle, { pointerId: 1 });

  expect(storedWidths()).toEqual({ modified: 136, type: 168 });
  expect(colWidths(view.container)).toEqual(["", "168px", "136px", "2.25rem"]);
  expect(handle.className).not.toContain("--dragging");
  expect(document.body.style.userSelect).toBe("");
});

test("dragging the fill column's edge stores only its neighbour", () => {
  const view = render(<ResizableTable />);
  const handle = view.getByRole("separator", {
    name: "Resize Name and Type columns",
  });

  press(handle, 400);
  fireEvent.pointerMove(handle, { clientX: 370, pointerId: 1 });
  fireEvent.pointerUp(handle, { pointerId: 1 });

  expect(storedWidths()).toEqual({ type: 158 });
  expect(colWidths(view.container)).toEqual(["", "158px", "11rem", "2.25rem"]);
});

test("a press that never moves, and a cancelled drag, store nothing", () => {
  const view = render(<ResizableTable />);
  const handle = view.getByRole("separator", {
    name: "Resize Type and Modified columns",
  });

  press(handle, 500);
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(storedWidths()).toBeNull();

  press(handle, 500);
  fireEvent.pointerMove(handle, { clientX: 560, pointerId: 1 });
  fireEvent.pointerCancel(handle, { pointerId: 1 });

  expect(storedWidths()).toBeNull();
  expect(colWidths(view.container)).toEqual(["", "8rem", "11rem", "2.25rem"]);
  expect(document.body.style.userSelect).toBe("");
});

test("only the primary button of the primary pointer starts a drag", () => {
  const view = render(<ResizableTable />);
  const handle = view.getByRole("separator", {
    name: "Resize Type and Modified columns",
  });

  fireEvent.pointerDown(handle, {
    button: 2,
    clientX: 500,
    isPrimary: true,
    pointerId: 1,
  });
  fireEvent.pointerMove(handle, { clientX: 560, pointerId: 1 });
  fireEvent.pointerDown(handle, {
    button: 0,
    clientX: 500,
    isPrimary: false,
    pointerId: 2,
  });
  fireEvent.pointerMove(handle, { clientX: 560, pointerId: 2 });

  expect(colWidths(view.container)).toEqual(["", "8rem", "11rem", "2.25rem"]);
});

test("the arrow keys move a focused handle, with Shift, Home and End for larger moves", () => {
  const view = render(<ResizableTable />);
  const handle = view.getByRole("separator", {
    name: "Resize Type and Modified columns",
  });

  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(storedWidths()).toEqual({ modified: 166, type: 138 });

  fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
  expect(storedWidths()).toEqual({ modified: 216, type: 88 });

  fireEvent.keyDown(handle, { key: "Home" });
  expect(storedWidths()).toEqual({ modified: 256, type: 48 });

  fireEvent.keyDown(handle, { key: "End" });
  expect(storedWidths()).toEqual({ modified: 48, type: 256 });
  expect(handle.getAttribute("aria-valuenow")).toBe("256");

  // Any other key is left alone.
  expect(fireEvent.keyDown(handle, { key: "Enter" })).toBe(true);
  expect(fireEvent.keyDown(handle, { key: "ArrowRight" })).toBe(false);
});

test("double-clicking a handle returns its two columns to their declared widths", () => {
  globalThis.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ modified: 300, type: 90 }),
  );
  const view = render(<ResizableTable />);
  expect(colWidths(view.container)).toEqual(["", "90px", "300px", "2.25rem"]);

  doubleClick(
    view.getByRole("separator", { name: "Resize Name and Type columns" }),
  );
  expect(colWidths(view.container)).toEqual(["", "8rem", "300px", "2.25rem"]);
  expect(storedWidths()).toEqual({ modified: 300 });

  doubleClick(
    view.getByRole("separator", { name: "Resize Type and Modified columns" }),
  );
  expect(colWidths(view.container)).toEqual(["", "8rem", "11rem", "2.25rem"]);
  // Nothing left to remember, so the preference itself goes.
  expect(storedWidths()).toBeNull();
});

test("two short drags in quick succession are not a double-click reset", () => {
  const view = render(<ResizableTable />);
  const handle = view.getByRole("separator", {
    name: "Resize Type and Modified columns",
  });

  for (const pointerId of [1, 2]) {
    press(handle, 500, pointerId);
    fireEvent.pointerMove(handle, { clientX: 504, pointerId });
    fireEvent.pointerUp(handle, { pointerId });
  }
  // The browser pairs the two releases' clicks into a double-click.
  fireEvent.doubleClick(handle);
  expect(storedWidths()).toEqual({ modified: 168, type: 136 });

  // One still press after a drag is not two.
  press(handle, 500, 3);
  fireEvent.pointerUp(handle, { pointerId: 3 });
  fireEvent.doubleClick(handle);
  expect(storedWidths()).toEqual({ modified: 168, type: 136 });
});

test("a click's jitter is not a drag, and still counts toward a reset", () => {
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ type: 90 }));
  const view = render(<ResizableTable />);
  const handle = view.getByRole("separator", {
    name: "Resize Type and Modified columns",
  });

  for (const pointerId of [1, 2]) {
    press(handle, 500, pointerId);
    fireEvent.pointerMove(handle, { clientX: 502, pointerId });
    // Nothing is drawn differently for a pointer that has barely moved.
    expect(colWidths(view.container)).toEqual(["", "90px", "11rem", "2.25rem"]);
    fireEvent.pointerUp(handle, { pointerId });
    expect(storedWidths()).toEqual({ type: 90 });
  }

  fireEvent.doubleClick(handle);
  expect(storedWidths()).toBeNull();
});

test("stored widths that are not usable widths are ignored", () => {
  globalThis.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ modified: "wide", name: 300, type: 4 }),
  );
  const view = render(<ResizableTable />);

  // `name` is the fill column, so even a usable stored width does not size it.
  expect(colWidths(view.container)).toEqual(["", "8rem", "11rem", "2.25rem"]);

  globalThis.localStorage.setItem(STORAGE_KEY, "[1, 2]");
  view.unmount();
  expect(colWidths(render(<ResizableTable />).container)).toEqual([
    "",
    "8rem",
    "11rem",
    "2.25rem",
  ]);
});

test("a table handed another storage key draws that key's widths at once", () => {
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ type: 90 }));
  globalThis.localStorage.setItem("test:other", JSON.stringify({ type: 210 }));
  const view = render(<ResizableTable />);
  expect(colWidths(view.container)[1]).toBe("90px");

  view.rerender(<ResizableTable storageKey="test:other" />);
  expect(colWidths(view.container)[1]).toBe("210px");

  fireEvent.keyDown(
    view.getByRole("separator", { name: "Resize Type and Modified columns" }),
    { key: "ArrowRight" },
  );
  expect(storedWidths("test:other")).toEqual({ modified: 166, type: 220 });
  expect(storedWidths()).toEqual({ type: 90 });
});

test("a table without the control, or without a fill column, has no handles", () => {
  const folded = render(<ResizableTable folded />);
  expect(folded.queryAllByRole("separator")).toEqual([]);
  expect(colWidths(folded.container)).toEqual(["", "8rem", "11rem", "2.25rem"]);
  expect(folded.getByRole("table").style.minWidth).toBe("");
  folded.unmount();

  const measured = render(
    <ResizableTable
      columns={COLUMNS.map((column) => ({ ...column, width: "6rem" }))}
    />,
  );
  expect(measured.queryAllByRole("separator")).toEqual([]);
  expect(measured.getByRole("table").style.minWidth).toBe("");
});

test("a table that folds mid-drag ends the drag without storing it", () => {
  const view = render(<ResizableTable />);
  const handle = view.getByRole("separator", {
    name: "Resize Type and Modified columns",
  });

  press(handle, 500);
  fireEvent.pointerMove(handle, { clientX: 540, pointerId: 1 });
  expect(document.body.style.userSelect).toBe("none");

  view.rerender(<ResizableTable folded />);
  expect(document.body.style.userSelect).toBe("");
  expect(storedWidths()).toBeNull();

  // Unfolded again, the abandoned drag is gone: the declared widths are back,
  // and a new drag starts cleanly.
  view.rerender(<ResizableTable />);
  expect(colWidths(view.container)).toEqual(["", "8rem", "11rem", "2.25rem"]);
  const next = view.getByRole("separator", {
    name: "Resize Type and Modified columns",
  });
  press(next, 500, 2);
  fireEvent.pointerMove(next, { clientX: 510, pointerId: 2 });
  fireEvent.pointerUp(next, { pointerId: 2 });
  expect(storedWidths()).toEqual({ modified: 166, type: 138 });
});

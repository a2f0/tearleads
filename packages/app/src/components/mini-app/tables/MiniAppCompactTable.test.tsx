import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  MiniAppCompactTableCell,
  MiniAppCompactTableHeader,
  shouldFoldCompactRows,
} from "./MiniAppCompactTable";

afterEach(cleanup);

test("compact rows fold below the enter width and unfold above the leave width", () => {
  // Wide frames never fold; narrow ones do.
  expect(shouldFoldCompactRows(900, false)).toBe(false);
  expect(shouldFoldCompactRows(320, false)).toBe(true);

  // Inside the band the current decision stands, in both directions, so a drag
  // parked on the boundary cannot re-fold on every pixel.
  expect(shouldFoldCompactRows(460, false)).toBe(false);
  expect(shouldFoldCompactRows(460, true)).toBe(true);

  // Past the far edge of the band it flips.
  expect(shouldFoldCompactRows(500, true)).toBe(false);
});

test("an unmeasured frame holds the current fold rather than reporting narrow", () => {
  // 0 is "not measured yet" — an unmounted frame, a render before the observer
  // has run, or a test environment with no layout engine. Treating it as narrow
  // would fold every table that is never measured.
  expect(shouldFoldCompactRows(0, false)).toBe(false);
  expect(shouldFoldCompactRows(0, true)).toBe(true);
  expect(shouldFoldCompactRows(Number.NaN, false)).toBe(false);
  expect(shouldFoldCompactRows(-1, false)).toBe(false);
});

test("folding is monotone, so a fold can never undo itself", () => {
  // Folding raises the row pitch, which can only make the content taller, which
  // can only add a scrollbar, which can only narrow the frame further. Walking
  // widths downward must therefore never leave the folded state.
  let compact = false;
  for (let width = 2000; width > 0; width -= 7) {
    const next = shouldFoldCompactRows(width, compact);
    if (compact) {
      expect(next).toBe(true);
    }
    compact = next;
  }
  expect(compact).toBe(true);
});

test("compact table header renders one line when there are no secondary fields", () => {
  const view = render(
    <table>
      <thead>
        <tr>
          <th>
            <MiniAppCompactTableHeader
              primary={[
                { id: "a", text: "A" },
                { id: "b", text: "B" },
              ]}
              secondary={[]}
            />
          </th>
        </tr>
      </thead>
    </table>,
  );

  expect(
    view.container.querySelectorAll(".mini-app-compact-table-line"),
  ).toHaveLength(1);
  expect(
    Array.from(
      view.container.querySelectorAll(".mini-app-compact-table-field"),
      (field) => field.textContent,
    ),
  ).toEqual(["A", "B"]);
});

test("compact table field renders content and skips the hidden label", () => {
  const view = render(
    <table>
      <tbody>
        <tr>
          <MiniAppCompactTableCell
            primary={[
              {
                content: <button type="button">Archive</button>,
                id: "name",
              },
            ]}
            secondary={[{ id: "type", label: "Type", text: "Folder" }]}
          />
        </tr>
      </tbody>
    </table>,
  );
  const lines = view.container.querySelectorAll(".mini-app-compact-table-line");

  // A `content` field carries no label, so the visually-hidden prefix never
  // lands inside the control's accessible name.
  expect(view.getByRole("button", { name: "Archive" })).toBeTruthy();
  expect(
    lines.item(0).querySelectorAll(".mini-app-compact-table-field-label"),
  ).toHaveLength(0);
  expect(
    lines.item(1).querySelector(".mini-app-compact-table-field")?.textContent,
  ).toBe("Type: Folder");
});

import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  MiniAppCompactTableCell,
  MiniAppCompactTableHeader,
} from "./MiniAppCompactTable";

afterEach(cleanup);

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

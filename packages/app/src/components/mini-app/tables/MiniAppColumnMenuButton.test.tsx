import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MiniAppColumnMenuButton } from "./MiniAppColumnMenuButton";

afterEach(() => cleanup());

test("column menu shows on/off state for each toggleable column", () => {
  const toggledColumns: string[] = [];
  const view = render(
    <MiniAppColumnMenuButton
      ariaLabel="Columns"
      hiddenColumns={new Set(["created"])}
      options={[
        { id: "type", label: "Type" },
        { id: "created", label: "Date created" },
        { id: "modified", label: "Date modified" },
      ]}
      stateLabels={{ off: "Off", on: "On" }}
      toggleColumn={(id) => toggledColumns.push(id)}
    />,
  );

  fireEvent.click(view.getByRole("button", { name: "Columns" }));

  expect(
    Array.from(
      view.baseElement.querySelectorAll(".mini-app-column-menu-item"),
    ).map((item) => ({
      label: item.querySelector(".mini-app-column-menu-label")?.textContent,
      state: item.querySelector(".mini-app-column-menu-state")?.textContent,
    })),
  ).toEqual([
    { label: "Type", state: "On" },
    { label: "Date created", state: "Off" },
    { label: "Date modified", state: "On" },
  ]);

  const createdColumnToggle = view.getByRole("checkbox", {
    name: "Date created Off",
  });

  expect((createdColumnToggle as HTMLInputElement).checked).toBe(false);

  fireEvent.click(createdColumnToggle);

  expect(toggledColumns).toEqual(["created"]);
});

test("column menu button does not bubble clicks to parent headers", () => {
  let parentClickCount = 0;
  const view = render(
    <table>
      <thead>
        <tr>
          <th
            onClick={() => parentClickCount++}
            onKeyDown={() => undefined}
            scope="col"
            tabIndex={0}
          >
            <MiniAppColumnMenuButton
              ariaLabel="Columns"
              hiddenColumns={new Set<string>()}
              options={[{ id: "type", label: "Type" }]}
              stateLabels={{ off: "Off", on: "On" }}
              toggleColumn={() => undefined}
            />
          </th>
        </tr>
      </thead>
    </table>,
  );

  fireEvent.click(view.getByRole("button", { name: "Columns" }));

  expect(parentClickCount).toBe(0);
});

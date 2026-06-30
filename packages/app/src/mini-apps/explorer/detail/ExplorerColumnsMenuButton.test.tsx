import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { EXPLORER_LABELS } from "../labels";
import { ExplorerColumnsMenuButton } from "./ExplorerColumnsMenuButton";
import type { ExplorerItemColumnId } from "./explorerItemColumnIds";

afterEach(() => cleanup());

test("columns menu shows on/off state for each toggleable column", () => {
  const toggledColumns: ExplorerItemColumnId[] = [];
  const view = render(
    <ExplorerColumnsMenuButton
      hiddenColumns={new Set<ExplorerItemColumnId>(["created"])}
      toggleColumn={(id) => toggledColumns.push(id)}
    />,
  );

  fireEvent.click(
    view.getByRole("button", { name: EXPLORER_LABELS.columnsMenuButton }),
  );

  expect(
    Array.from(
      view.baseElement.querySelectorAll(".explorer-columns-menu-item"),
    ).map((item) => ({
      label: item.querySelector(".explorer-columns-menu-label")?.textContent,
      state: item.querySelector(".explorer-columns-menu-state")?.textContent,
    })),
  ).toEqual([
    {
      label: EXPLORER_LABELS.itemTypeColumn,
      state: EXPLORER_LABELS.columnsMenuStateOn,
    },
    {
      label: EXPLORER_LABELS.dateCreatedColumn,
      state: EXPLORER_LABELS.columnsMenuStateOff,
    },
    {
      label: EXPLORER_LABELS.dateModifiedColumn,
      state: EXPLORER_LABELS.columnsMenuStateOn,
    },
    {
      label: EXPLORER_LABELS.itemSyncColumn,
      state: EXPLORER_LABELS.columnsMenuStateOn,
    },
  ]);

  const createdColumnToggle = view.getByRole("checkbox", {
    name: `${EXPLORER_LABELS.dateCreatedColumn} ${EXPLORER_LABELS.columnsMenuStateOff}`,
  });

  expect((createdColumnToggle as HTMLInputElement).checked).toBe(false);

  fireEvent.click(createdColumnToggle);

  expect(toggledColumns).toEqual(["created"]);
});

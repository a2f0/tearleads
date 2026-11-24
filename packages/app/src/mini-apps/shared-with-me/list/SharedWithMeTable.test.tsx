import { afterEach, expect, mock, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { SHARED_WITH_ME_LABELS } from "../labels";
import type {
  SharedOrganization,
  SharedWithMeRow,
} from "../model/sharedWithMeRows";
import { SharedWithMeTable } from "./SharedWithMeTable";

afterEach(() => {
  cleanup();
  // The column menu remembers hidden columns on this device.
  globalThis.localStorage.clear();
});

const acme: SharedOrganization = {
  canAskToLeave: true,
  leaveRequested: false,
  name: "Acme",
  organizationId: "acme",
  syncPaused: false,
};
const globex: SharedOrganization = {
  canAskToLeave: true,
  leaveRequested: true,
  name: null,
  organizationId: "globex",
  syncPaused: false,
};

const rows: SharedWithMeRow[] = [
  {
    folder: {
      accessLevel: "admin",
      id: "root",
      name: "root",
      workspaceRoot: true,
    },
    key: "folder:root",
    kind: "folder",
    organization: acme,
  },
  {
    folder: {
      accessLevel: "write",
      id: "design",
      name: "Design",
      workspaceRoot: false,
    },
    key: "folder:design",
    kind: "folder",
    organization: { ...acme, syncPaused: true },
  },
  { key: "organization:globex", kind: "organization", organization: globex },
];

function renderTable(
  overrides: Partial<Parameters<typeof SharedWithMeTable>[0]> = {},
) {
  const onOpenFolder = mock((_folderId: string) => {});
  const onRowContextMenu = mock((_event: unknown, _rowKey: string) => {});
  const view = render(
    <SharedWithMeTable
      changingOrganizationId={null}
      contextRowKey={null}
      onOpenFolder={onOpenFolder}
      onRowContextMenu={onRowContextMenu}
      rows={rows}
      {...overrides}
    />,
  );
  const table = view.getByRole("table", { name: SHARED_WITH_ME_LABELS.title });
  const rowNamed = (name: string) => {
    // An organization row repeats its name in the organization column.
    const row = within(table).getAllByText(name)[0]?.closest("tr");
    if (!row) throw new Error(`No row for ${name}`);
    return row;
  };
  const cellTexts = (name: string) =>
    within(rowNamed(name))
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
  return { cellTexts, onOpenFolder, onRowContextMenu, rowNamed };
}

test("lists each folder with its organization, permission, and status", () => {
  const { cellTexts } = renderTable();

  expect(cellTexts(SHARED_WITH_ME_LABELS.workspaceRoot)).toEqual([
    SHARED_WITH_ME_LABELS.workspaceRoot,
    "Acme",
    SHARED_WITH_ME_LABELS.permissionAdmin,
    SHARED_WITH_ME_LABELS.syncEnabledStatus,
    "",
  ]);
  expect(cellTexts("Design")).toEqual([
    "Design",
    "Acme",
    SHARED_WITH_ME_LABELS.permissionWrite,
    SHARED_WITH_ME_LABELS.syncPausedStatus,
    "",
  ]);
});

test("explains whether each row's organization syncs", () => {
  const { rowNamed } = renderTable();

  expect(
    within(rowNamed(SHARED_WITH_ME_LABELS.workspaceRoot))
      .getByText(SHARED_WITH_ME_LABELS.syncEnabledStatus)
      .getAttribute("title"),
  ).toBe(SHARED_WITH_ME_LABELS.syncEnabledStatusDetail);
  expect(
    within(rowNamed("Design"))
      .getByText(SHARED_WITH_ME_LABELS.syncPausedStatus)
      .getAttribute("title"),
  ).toBe(SHARED_WITH_ME_LABELS.syncPausedStatusDetail);
});

test("gives an organization with no listed folder a row of its own", () => {
  const { cellTexts } = renderTable();

  expect(cellTexts(SHARED_WITH_ME_LABELS.unnamedOrganization)).toEqual([
    SHARED_WITH_ME_LABELS.unnamedOrganization,
    SHARED_WITH_ME_LABELS.unnamedOrganization,
    SHARED_WITH_ME_LABELS.permissionNone,
    `${SHARED_WITH_ME_LABELS.syncEnabledStatus}, ${SHARED_WITH_ME_LABELS.leaveRequestedStatus}, ${SHARED_WITH_ME_LABELS.nothingSharedStatus}`,
    "",
  ]);
});

test("shows a running change on every row of its organization", () => {
  const { cellTexts } = renderTable({ changingOrganizationId: "acme" });

  expect(cellTexts("Design")[3]).toBe(SHARED_WITH_ME_LABELS.updatingStatus);
  expect(cellTexts(SHARED_WITH_ME_LABELS.workspaceRoot)[3]).toBe(
    SHARED_WITH_ME_LABELS.updatingStatus,
  );
});

test("opens a folder from its row, and the row menu from a right-click or its actions button", () => {
  const { onOpenFolder, onRowContextMenu, rowNamed } = renderTable();

  fireEvent.click(
    within(rowNamed("Design")).getByRole("button", { name: "Design" }),
  );
  expect(onOpenFolder.mock.calls).toEqual([["design"]]);

  fireEvent.contextMenu(rowNamed("Design"));
  fireEvent.click(
    within(rowNamed(SHARED_WITH_ME_LABELS.unnamedOrganization)).getByRole(
      "button",
      {
        name: SHARED_WITH_ME_LABELS.actionsFor(
          SHARED_WITH_ME_LABELS.unnamedOrganization,
        ),
      },
    ),
  );
  expect(onRowContextMenu.mock.calls.map(([, rowKey]) => rowKey)).toEqual([
    "folder:design",
    "organization:globex",
  ]);
});

test("an organization row has nothing to open", () => {
  const { onOpenFolder, rowNamed } = renderTable();
  const row = rowNamed(SHARED_WITH_ME_LABELS.unnamedOrganization);

  fireEvent.click(row);
  expect(
    within(row).queryByRole("button", {
      name: SHARED_WITH_ME_LABELS.unnamedOrganization,
    }),
  ).toBeNull();
  expect(onOpenFolder).not.toHaveBeenCalled();
});

test("highlights the row whose menu is open", () => {
  const { rowNamed } = renderTable({ contextRowKey: "folder:design" });

  expect(rowNamed("Design").className).toContain(
    "mini-app-table-row--selected",
  );
  expect(rowNamed(SHARED_WITH_ME_LABELS.workspaceRoot).className).not.toContain(
    "mini-app-table-row--selected",
  );
});

test("hides a detail column from the heading's column menu, and remembers it", () => {
  const { cellTexts } = renderTable();
  const designWithoutOrganization = [
    "Design",
    SHARED_WITH_ME_LABELS.permissionWrite,
    SHARED_WITH_ME_LABELS.syncPausedStatus,
    "",
  ];

  fireEvent.click(
    screen.getByRole("button", { name: SHARED_WITH_ME_LABELS.columnsMenu }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: `${SHARED_WITH_ME_LABELS.organizationColumn} ${SHARED_WITH_ME_LABELS.columnsMenuStateOn}`,
    }),
  );

  expect(
    screen.queryByRole("columnheader", {
      name: SHARED_WITH_ME_LABELS.organizationColumn,
    }),
  ).toBeNull();
  expect(cellTexts("Design")).toEqual(designWithoutOrganization);

  cleanup();
  expect(renderTable().cellTexts("Design")).toEqual(designWithoutOrganization);
});

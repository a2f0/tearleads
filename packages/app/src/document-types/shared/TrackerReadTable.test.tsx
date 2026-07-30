import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { WithWindowToolbar } from "../../../test/helpers/windowToolbarProbe";
import { BloodPressureFields } from "../blood-pressure/BloodPressure";
import type { BloodPressureReadingRow } from "../blood-pressure/bloodPressureReadings";

/**
 * The index (list) view every tracker presents in read mode: one table, one set
 * of sortable column headers, and a trailing kebab per row.
 *
 * Blood pressure stands in for all three trackers — the table, its sort state
 * and its empty row are the shared component's behaviour, and each document type
 * only supplies the columns. The two-line phone fold is covered separately in
 * TrackerReadTable.twoLine.test.tsx.
 */

afterEach(() => {
  cleanup();
  // The columns menu persists what the reader switched off, so one test's choice
  // would otherwise be the next test's starting state.
  globalThis.localStorage.clear();
});

function makeReading(
  overrides: Partial<BloodPressureReadingRow> & { id: string },
): BloodPressureReadingRow {
  return {
    createdAt: "",
    createdBy: "",
    createdByPeer: null,
    diastolic: "",
    fieldEditors: {},
    measuredAt: "",
    notes: "",
    pulse: "",
    systolic: "",
    updatedAt: "",
    updatedBy: "",
    updatedByPeer: null,
    ...overrides,
  };
}

const readings: BloodPressureReadingRow[] = [
  makeReading({
    diastolic: "80",
    id: "r1",
    measuredAt: "2026-07-16T08:30",
    notes: "Before coffee",
    pulse: "72",
    systolic: "120",
    updatedAt: "2026-07-16T08:30:00.000Z",
    updatedBy: "user-alice",
  }),
  makeReading({
    diastolic: "76",
    id: "r2",
    measuredAt: "2026-07-16T20:15",
    systolic: "118",
  }),
];

function renderReadTable(params?: {
  resolveRowWriter?:
    | ((updatedByPeer: string | null) => string | null)
    | undefined;
  rows?: BloodPressureReadingRow[];
}) {
  return render(
    <WithWindowToolbar>
      <BloodPressureFields
        currentAuthorId="user-alice"
        isEditing={false}
        onAddReading={() => Promise.resolve("new-reading")}
        onRemoveReading={() => undefined}
        onRenameTracker={() => undefined}
        onToggleEditing={() => undefined}
        onUpdateReading={() => undefined}
        readings={params?.rows ?? readings}
        ready
        resolveRowWriter={params?.resolveRowWriter}
        trackerName="Home log"
        trackerNameInputId="blood-pressure-name"
      />
    </WithWindowToolbar>,
  );
}

/** Switch a hideable column on (or off) through the table's columns menu. */
function toggleColumn(view: ReturnType<typeof render>, label: string) {
  fireEvent.click(view.getByRole("button", { name: "Columns" }));
  // Each entry is a checkbox whose accessible name is the column plus its state.
  fireEvent.click(
    view.getByRole("checkbox", { name: new RegExp(`^${label} `, "u") }),
  );
}

test("read mode lists every entry under one set of column headers", () => {
  const view = renderReadTable();
  const table = view.getByRole("table", { name: "Readings" });
  // The default column set: attribution starts switched off (see below).
  const columnNames = ["#", "Reading", "Pulse", "Measured", "Notes", "Actions"];

  for (const name of columnNames) {
    expect(within(table).getByRole("columnheader", { name })).toBeTruthy();
  }
  expect(within(table).getAllByRole("columnheader")).toHaveLength(
    columnNames.length,
  );
  expect(within(table).getAllByRole("row")).toHaveLength(
    // One header row plus one row per reading — every reading is a row of this
    // one table, not a card carrying headings of its own.
    readings.length + 1,
  );
});

test("read mode sorts by a column without renumbering the entries", () => {
  const view = renderReadTable();
  const cellsInColumn = (column: number) =>
    view
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelectorAll("td")[column]?.textContent);
  const sortState = () =>
    view
      .getByRole("columnheader", { name: "Reading" })
      .getAttribute("aria-sort");

  expect(cellsInColumn(1)).toEqual(["120/80 mmHg", "118/76 mmHg"]);

  // Ascending by systolic puts the lower reading first. The ordinals travel with
  // their rows, because they name the reading — and the controls named after it —
  // rather than its position on screen.
  fireEvent.click(view.getByRole("button", { name: "Reading" }));
  expect(cellsInColumn(1)).toEqual(["118/76 mmHg", "120/80 mmHg"]);
  expect(cellsInColumn(0)).toEqual(["2", "1"]);
  expect(sortState()).toBe("ascending");

  // Clicking the active header again reverses it.
  fireEvent.click(view.getByRole("button", { name: "Reading" }));
  expect(cellsInColumn(1)).toEqual(["120/80 mmHg", "118/76 mmHg"]);
  expect(sortState()).toBe("descending");
});

test("read mode orders a column's blank cells last in both directions", () => {
  const view = renderReadTable({
    rows: [
      makeReading({ id: "r-blank" }),
      makeReading({ id: "r-low", diastolic: "70", systolic: "110" }),
      makeReading({ id: "r-high", diastolic: "90", systolic: "140" }),
    ],
  });
  const readings = () =>
    view
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelectorAll("td")[1]?.textContent);

  fireEvent.click(view.getByRole("button", { name: "Reading" }));
  expect(readings()).toEqual(["110/70 mmHg", "140/90 mmHg", "None"]);

  // A row with no reading at all has no place among the ordered ones, so
  // reversing the column must not lift it to the top: only the rows that have a
  // value change places.
  fireEvent.click(view.getByRole("button", { name: "Reading" }));
  expect(readings()).toEqual(["140/90 mmHg", "110/70 mmHg", "None"]);
});

test("read mode heads an empty tracker with its columns and an empty row", () => {
  const view = renderReadTable({ rows: [] });

  expect(view.getByRole("columnheader", { name: "Reading" })).toBeTruthy();
  expect(view.getByText("No readings")).toBeTruthy();
});

test("the columns menu switches the attribution column on and off", () => {
  const view = renderReadTable();

  // Off by default: a byline is the widest and least-scanned column, so the
  // table opens without it and the reader turns it on.
  expect(view.queryByRole("columnheader", { name: "Updated" })).toBeNull();
  expect(view.queryByText("2026-07-16 08:30 by you")).toBeNull();

  toggleColumn(view, "Updated");
  expect(view.getByRole("columnheader", { name: "Updated" })).toBeTruthy();
  // The verb is the header, so the cell carries the byline alone.
  expect(view.getByText("2026-07-16 08:30 by you")).toBeTruthy();

  toggleColumn(view, "Updated");
  expect(view.queryByRole("columnheader", { name: "Updated" })).toBeNull();
});

test("the attribution column prefers the verified writer over the self-attested one", () => {
  const view = renderReadTable({
    // Peer 9 verifies user-bob over the row's self-attested user-alice.
    resolveRowWriter: (peer) => (peer === "9" ? "user-bob" : null),
    rows: [
      makeReading({
        diastolic: "80",
        id: "r1",
        systolic: "120",
        updatedAt: "2026-07-16T08:30:00.000Z",
        updatedBy: "user-alice",
        updatedByPeer: "9",
      }),
    ],
  });
  toggleColumn(view, "Updated");

  expect(view.getByText("2026-07-16 08:30 by user-bob")).toBeTruthy();
  expect(view.queryByText("2026-07-16 08:30 by you")).toBeNull();
});

test("the attribution column falls back to the self-attested author", () => {
  // r1's updatedBy is user-alice, the local author, so it reads as "you".
  const view = renderReadTable({ resolveRowWriter: () => null });
  toggleColumn(view, "Updated");

  expect(view.getByText("2026-07-16 08:30 by you")).toBeTruthy();
});

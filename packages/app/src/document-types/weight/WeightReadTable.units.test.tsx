import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { WeightReadTable } from "./WeightReadTable";
import type { WeightEntryRow } from "./weightEntries";

/**
 * A weight tracker may hold entries in both units — each entry records the unit
 * it was captured in, and no client can hold a tracker-wide one. Ordering them by
 * the bare figure therefore answers the wrong question: 90 kg is heavier than
 * 180 lb, and a "sort by weight" that files it first is simply wrong.
 *
 * Nothing converted here is ever drawn: every assertion below also checks that
 * each row still reads in the unit it was recorded in.
 */

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

function makeEntry(
  overrides: Partial<WeightEntryRow> & { id: string },
): WeightEntryRow {
  return {
    createdAt: "",
    createdBy: "",
    createdByPeer: null,
    fieldEditors: {},
    measuredAt: "",
    notes: "",
    unit: "lb",
    updatedAt: "",
    updatedBy: "",
    updatedByPeer: null,
    weight: "",
    ...overrides,
  };
}

function renderWeightTable(entries: WeightEntryRow[]) {
  return render(
    <WeightReadTable
      currentAuthorId="user-alice"
      entries={entries}
      onEnterEdit={() => undefined}
    />,
  );
}

/**
 * Every body row's cell under the named column, found by the column's accessible
 * name rather than by position, so switching another column on or off does not
 * silently move which cell an assertion reads.
 */
function cellsUnder(view: ReturnType<typeof render>, name: string) {
  const index = view
    .getAllByRole("columnheader")
    .indexOf(view.getByRole("columnheader", { name }));
  return view
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.querySelectorAll("td")[index]?.textContent);
}

test("weight sorts across units by what was weighed, not by the figure", () => {
  // 90 kg is ~198 lb, so it outweighs both pound entries despite the smaller
  // number; 70 kg is ~154 lb and sits below them.
  const view = renderWeightTable([
    makeEntry({ id: "e-180lb", weight: "180" }),
    makeEntry({ id: "e-90kg", unit: "kg", weight: "90" }),
    makeEntry({ id: "e-160lb", weight: "160" }),
    makeEntry({ id: "e-70kg", unit: "kg", weight: "70" }),
  ]);

  fireEvent.click(view.getByRole("button", { name: "Weight" }));
  expect(cellsUnder(view, "Weight")).toEqual([
    "70 kg",
    "160 lb",
    "180 lb",
    "90 kg",
  ]);

  fireEvent.click(view.getByRole("button", { name: "Weight" }));
  expect(cellsUnder(view, "Weight")).toEqual([
    "90 kg",
    "180 lb",
    "160 lb",
    "70 kg",
  ]);
});

test("a weight the document would reject sorts last in both directions", () => {
  // "180abc" is not a measurement this document accepts. It must not order as
  // 180 among the real ones, which a leading-prefix parse would have done.
  const view = renderWeightTable([
    makeEntry({ id: "e-junk", weight: "180abc" }),
    makeEntry({ id: "e-120", weight: "120" }),
    makeEntry({ id: "e-200", weight: "200" }),
  ]);

  fireEvent.click(view.getByRole("button", { name: "Weight" }));
  expect(cellsUnder(view, "Weight")).toEqual(["120 lb", "200 lb", "180abc lb"]);

  fireEvent.click(view.getByRole("button", { name: "Weight" }));
  expect(cellsUnder(view, "Weight")).toEqual(["200 lb", "120 lb", "180abc lb"]);
});

test("change sorts across units by the magnitude of the change", () => {
  // Consecutive same-unit pairs, so both entries have a comparable change:
  // +5 kg is ~+11 lb and therefore the larger gain.
  const view = renderWeightTable([
    makeEntry({ id: "e1", weight: "180" }),
    makeEntry({ id: "e2", weight: "188" }),
    makeEntry({ id: "e3", unit: "kg", weight: "80" }),
    makeEntry({ id: "e4", unit: "kg", weight: "85" }),
  ]);
  const changeCells = () => cellsUnder(view, "Change");

  fireEvent.click(view.getByRole("button", { name: "Change" }));
  // e1 and e3 have no comparable predecessor, so they hold the tail.
  expect(changeCells().slice(0, 2)).toEqual(["+8 lb", "+5 kg"]);
  expect(changeCells().slice(2)).toEqual(["—", "—"]);
});

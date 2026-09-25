import { afterEach, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { WithWindowToolbar } from "../../../test/helpers/windowToolbarProbe";
import { BloodPressureFields } from "../blood-pressure/BloodPressure";
import type { BloodPressureReadingRow } from "../blood-pressure/bloodPressureReadings";
import { WeightFields } from "../weight/Weight";
import type { WeightEntryRow } from "../weight/weightEntries";

afterEach(cleanup);

const metadata = {
  measuredAt: "2026-07-16T08:30",
  notes: "",
  createdAt: "",
  createdBy: "",
  createdByPeer: null,
  updatedAt: "",
  updatedBy: "",
  updatedByPeer: null,
  fieldEditors: {},
};
const controls = {
  onRenameTracker: () => undefined,
  onToggleEditing: () => undefined,
  ready: true,
  trackerName: "Test tracker",
  trackerNameInputId: "tracker-name",
};

function weightFields(
  entries: WeightEntryRow[],
  ready = true,
  isEditing = false,
) {
  return (
    <WithWindowToolbar>
      <WeightFields
        {...controls}
        entries={entries}
        ready={ready}
        isEditing={isEditing}
        unit="kg"
        unitInputId="unit"
        onAddEntry={() => Promise.resolve(null)}
        onChangeUnit={() => undefined}
        onRemoveEntry={() => undefined}
        onUpdateEntry={() => undefined}
      />
    </WithWindowToolbar>
  );
}

test("weight graphs preserve per-entry units and update with the document", () => {
  const entries: WeightEntryRow[] = [
    { ...metadata, id: "lb", unit: "lb", weight: "180.25" },
    { ...metadata, id: "kg", unit: "kg", weight: "80" },
    { ...metadata, id: "bad", unit: "lb", weight: "8000" },
    { ...metadata, id: "empty", unit: "kg", weight: "" },
  ];
  const view = render(weightFields(entries));
  const pounds = view.getByRole("img", { name: "Weight over time (lb)" });
  const kilos = view.getByRole("img", { name: "Weight over time (kg)" });
  expect(pounds.querySelectorAll("circle")).toHaveLength(1);
  expect(pounds.querySelector("circle")?.textContent).toContain("180.25 lb");
  expect(kilos.querySelectorAll("circle")).toHaveLength(1);
  expect(kilos.querySelector("circle")?.textContent).toContain("80 kg");
  view.rerender(
    weightFields([{ ...metadata, id: "kg", unit: "kg", weight: "81" }]),
  );
  expect(view.queryByRole("img", { name: "Weight over time (lb)" })).toBeNull();
  expect(view.getByRole("img").querySelector("circle")?.textContent).toContain(
    "81 kg",
  );
  view.rerender(weightFields(entries, false));
  expect(view.queryByRole("img")).toBeNull();
  view.rerender(weightFields(entries, true, true));
  expect(view.queryByRole("img")).toBeNull();
});

test("blood pressure shares a pressure scale and keeps optional pulse in bpm", () => {
  const readings: BloodPressureReadingRow[] = [
    { ...metadata, id: "valid", systolic: "120", diastolic: "80", pulse: "72" },
    { ...metadata, id: "partial", systolic: "900", diastolic: "78", pulse: "" },
    {
      ...metadata,
      id: "undated",
      measuredAt: "",
      systolic: "118",
      diastolic: "76",
      pulse: "",
    },
  ];
  const view = render(
    <WithWindowToolbar>
      <BloodPressureFields
        {...controls}
        readings={readings}
        isEditing={false}
        onAddReading={() => Promise.resolve(null)}
        onRemoveReading={() => undefined}
        onUpdateReading={() => undefined}
      />
    </WithWindowToolbar>,
  );
  const pressure = view.getByRole("img", { name: "Blood pressure over time" });
  const pulse = view.getByRole("img", { name: "Pulse over time" });
  expect(pressure.querySelectorAll("circle")).toHaveLength(3);
  expect(pulse.querySelectorAll("circle")).toHaveLength(1);
  expect(pulse.querySelector("circle")?.textContent).toContain("72 bpm");
  const legend = view.getByRole("list", {
    name: "Blood pressure over time series",
  });
  expect(within(legend).getByText("Systolic")).toBeTruthy();
  expect(within(legend).getByText("Diastolic")).toBeTruthy();
});

import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BloodPressureFields } from "./BloodPressure";
import type { BloodPressureReadingRow } from "./bloodPressureReadings";

afterEach(cleanup);

const readings: BloodPressureReadingRow[] = [
  {
    id: "r1",
    systolic: "120",
    diastolic: "80",
    pulse: "72",
    measuredAt: "2026-07-16T08:30",
    notes: "Before coffee",
    updatedAt: "2026-07-16T08:30:00.000Z",
    updatedBy: "user-alice",
  },
  {
    id: "r2",
    systolic: "118",
    diastolic: "76",
    pulse: "",
    measuredAt: "2026-07-16T20:15",
    notes: "",
    updatedAt: "",
    updatedBy: "",
  },
];

function renderBloodPressureFields(params?: {
  currentAuthorId?: string | null;
  isEditing?: boolean | undefined;
  onAddReading?: () => void;
  onRemoveReading?: (id: string) => void;
  onRenameTracker?: (value: string) => void;
  onUpdateReading?: (id: string, field: string, value: string) => void;
  readings?: BloodPressureReadingRow[];
  ready?: boolean;
}) {
  return render(
    <BloodPressureFields
      currentAuthorId={params?.currentAuthorId ?? null}
      isEditing={params?.isEditing}
      onAddReading={params?.onAddReading ?? (() => undefined)}
      onRemoveReading={params?.onRemoveReading ?? (() => undefined)}
      onRenameTracker={params?.onRenameTracker ?? (() => undefined)}
      onUpdateReading={params?.onUpdateReading ?? (() => undefined)}
      readings={params?.readings ?? readings}
      ready={params?.ready ?? true}
      trackerName="Home log"
      trackerNameInputId="blood-pressure-name"
    />,
  );
}

test("renders readings as editable measurement rows", () => {
  const view = renderBloodPressureFields();

  expect(
    (view.getByLabelText("Blood pressure tracker name") as HTMLInputElement)
      .value,
  ).toBe("Home log");
  expect(
    (view.getByLabelText("Reading 1 systolic") as HTMLInputElement).value,
  ).toBe("120");
  expect(
    (view.getByLabelText("Reading 1 diastolic") as HTMLInputElement).value,
  ).toBe("80");
  expect(
    (view.getByLabelText("Reading 1 pulse") as HTMLInputElement).value,
  ).toBe("72");
  expect(
    (view.getByLabelText("Reading 1 measured at") as HTMLInputElement).value,
  ).toBe("2026-07-16T08:30");
  expect(
    view.container.querySelector(".blood-pressure-reading-row"),
  ).toBeTruthy();
});

test("read mode renders formatted measurements and attribution", () => {
  const view = renderBloodPressureFields({
    currentAuthorId: "user-alice",
    isEditing: false,
  });

  expect(view.getByText("Home log")).toBeTruthy();
  expect(view.getByText("120/80 mmHg")).toBeTruthy();
  expect(view.getByText("72 bpm")).toBeTruthy();
  expect(view.getByText("2026-07-16 08:30")).toBeTruthy();
  expect(view.getByText("Before coffee")).toBeTruthy();
  expect(view.getByText("Updated 2026-07-16 08:30 by you")).toBeTruthy();
  expect(view.queryByLabelText("Blood pressure tracker name")).toBeNull();
});

test("read mode tolerates missing reading values", () => {
  const view = renderBloodPressureFields({
    readings: [
      {
        id: "r-missing",
        systolic: "",
        diastolic: "",
        pulse: "",
        measuredAt: "",
        notes: "",
        updatedAt: "",
        updatedBy: "",
      },
    ],
    isEditing: false,
  });

  // Reading pair, pulse, and measured time all fall back to None.
  expect(view.getAllByText("None")).toHaveLength(3);
});

test("edits tracker name and reading cells through callbacks", () => {
  const renameCalls: string[] = [];
  const updateCalls: Array<[string, string, string]> = [];
  const view = renderBloodPressureFields({
    onRenameTracker: (value) => renameCalls.push(value),
    onUpdateReading: (id, field, value) => updateCalls.push([id, field, value]),
  });

  fireEvent.change(view.getByLabelText("Blood pressure tracker name"), {
    target: { value: "Clinic" },
  });
  fireEvent.change(view.getByLabelText("Reading 1 systolic"), {
    target: { value: "125" },
  });
  fireEvent.change(view.getByLabelText("Reading 2 notes"), {
    target: { value: "After walk" },
  });

  expect(renameCalls).toEqual(["Clinic"]);
  expect(updateCalls).toEqual([
    ["r1", "systolic", "125"],
    ["r2", "notes", "After walk"],
  ]);
});

test("marks out-of-range measurements invalid without blocking edits", () => {
  const view = renderBloodPressureFields({
    readings: [
      {
        id: "r-bad",
        systolic: "1200",
        diastolic: "80",
        pulse: "",
        measuredAt: "",
        notes: "",
        updatedAt: "",
        updatedBy: "",
      },
    ],
  });

  expect(
    view.getByLabelText("Reading 1 systolic").getAttribute("aria-invalid"),
  ).toBe("true");
  expect(
    view.getByLabelText("Reading 1 diastolic").getAttribute("aria-invalid"),
  ).toBeNull();
});

test("add and remove buttons invoke their callbacks", () => {
  let addCalls = 0;
  const removeCalls: string[] = [];
  const view = renderBloodPressureFields({
    onAddReading: () => {
      addCalls += 1;
    },
    onRemoveReading: (id) => removeCalls.push(id),
  });

  fireEvent.click(view.getByRole("button", { name: "Add Reading" }));
  fireEvent.click(view.getByRole("button", { name: "Remove reading 1" }));

  expect(addCalls).toBe(1);
  expect(removeCalls).toEqual(["r1"]);
});

test("disables controls while the document is loading", () => {
  const view = renderBloodPressureFields({ ready: false });

  expect(
    (view.getByLabelText("Blood pressure tracker name") as HTMLInputElement)
      .disabled,
  ).toBe(true);
  expect(
    (view.getByLabelText("Reading 1 systolic") as HTMLInputElement).disabled,
  ).toBe(true);
  expect(
    (view.getByRole("button", { name: "Add Reading" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { WithWindowToolbar } from "../../../test/helpers/windowToolbarProbe";
import { BloodPressureFields } from "../blood-pressure/BloodPressure";
import type { BloodPressureReadingRow } from "../blood-pressure/bloodPressureReadings";
import { EnvFileFields } from "../env-file/EnvFile";
import type { EnvVariableRow } from "../env-file/envFileVariables";
import { WeightFields } from "../weight/Weight";
import type { WeightEntryRow } from "../weight/weightEntries";

afterEach(cleanup);

function makeBloodPressureReading(
  overrides: Partial<BloodPressureReadingRow> & { id: string },
): BloodPressureReadingRow {
  return {
    systolic: "",
    diastolic: "",
    pulse: "",
    measuredAt: "",
    notes: "",
    createdAt: "",
    createdBy: "",
    createdByPeer: null,
    updatedAt: "",
    updatedBy: "",
    updatedByPeer: null,
    fieldEditors: {},
    ...overrides,
  };
}

function BloodPressureHarness() {
  const [readings, setReadings] = useState<BloodPressureReadingRow[]>([
    makeBloodPressureReading({ id: "r-existing", systolic: "120" }),
  ]);

  return (
    <WithWindowToolbar>
      <BloodPressureFields
        isEditing
        onAddReading={(reading) => {
          const id = "r-new";
          setReadings((current) => [
            ...current,
            makeBloodPressureReading({ id, ...reading }),
          ]);
          return Promise.resolve(id);
        }}
        onRemoveReading={() => undefined}
        onRenameTracker={() => undefined}
        onToggleEditing={() => undefined}
        onUpdateReading={() => undefined}
        readings={readings}
        ready
        trackerName="Home log"
        trackerNameInputId="blood-pressure-name"
      />
    </WithWindowToolbar>
  );
}

test("edit-mode blood pressure quick-add saves only the added row", async () => {
  const view = render(<BloodPressureHarness />);
  fireEvent.click(view.getByRole("button", { name: "Add Reading" }));
  fireEvent.change(view.getByLabelText("Quick add systolic"), {
    target: { value: "118" },
  });
  fireEvent.change(view.getByLabelText("Quick add diastolic"), {
    target: { value: "76" },
  });
  fireEvent.click(view.getByRole("button", { name: "Save Reading" }));

  await waitFor(() =>
    expect(
      view.getByRole("button", { name: "Reading 2 actions" }),
    ).toBeTruthy(),
  );
  expect(view.queryByLabelText("Reading 2 systolic")).toBeNull();
  expect(view.getByLabelText("Reading 1 systolic")).toBeTruthy();
});

function makeWeightEntry(
  overrides: Partial<WeightEntryRow> & { id: string },
): WeightEntryRow {
  return {
    weight: "",
    unit: "lb",
    measuredAt: "",
    notes: "",
    createdAt: "",
    createdBy: "",
    createdByPeer: null,
    updatedAt: "",
    updatedBy: "",
    updatedByPeer: null,
    fieldEditors: {},
    ...overrides,
  };
}

function WeightHarness() {
  const [entries, setEntries] = useState<WeightEntryRow[]>([
    makeWeightEntry({ id: "e-existing", weight: "180" }),
  ]);

  return (
    <WithWindowToolbar>
      <WeightFields
        entries={entries}
        isEditing
        onAddEntry={(entry) => {
          const id = "e-new";
          setEntries((current) => [
            ...current,
            makeWeightEntry({ id, ...entry }),
          ]);
          return Promise.resolve(id);
        }}
        onChangeUnit={() => undefined}
        onRemoveEntry={() => undefined}
        onRenameTracker={() => undefined}
        onToggleEditing={() => undefined}
        onUpdateEntry={() => undefined}
        ready
        trackerName="Morning weigh-ins"
        trackerNameInputId="weight-name"
        unit="lb"
        unitInputId="weight-unit"
      />
    </WithWindowToolbar>
  );
}

test("edit-mode weight quick-add saves only the added row", async () => {
  const view = render(<WeightHarness />);
  fireEvent.click(view.getByRole("button", { name: "Add Entry" }));
  fireEvent.change(view.getByLabelText("Quick add weight"), {
    target: { value: "179" },
  });
  fireEvent.click(view.getByRole("button", { name: "Save Entry" }));

  await waitFor(() =>
    expect(view.getByRole("button", { name: "Entry 2 actions" })).toBeTruthy(),
  );
  expect(view.queryByLabelText("Entry 2 weight")).toBeNull();
  expect(view.getByLabelText("Entry 1 weight")).toBeTruthy();
});

function makeEnvVariable(
  overrides: Partial<EnvVariableRow> & { id: string },
): EnvVariableRow {
  return {
    key: "",
    value: "",
    createdAt: "",
    createdBy: "",
    createdByPeer: null,
    updatedAt: "",
    updatedBy: "",
    updatedByPeer: null,
    fieldEditors: {},
    ...overrides,
  };
}

function EnvFileHarness() {
  const [variables, setVariables] = useState<EnvVariableRow[]>([
    makeEnvVariable({ id: "v-existing", key: "DEBUG", value: "true" }),
  ]);

  return (
    <WithWindowToolbar>
      <EnvFileFields
        fileName=".env"
        fileNameInputId="env-file-name"
        isEditing
        onAddVariable={(variable) => {
          const id = "v-new";
          setVariables((current) => [
            ...current,
            makeEnvVariable({ id, ...variable }),
          ]);
          return Promise.resolve(id);
        }}
        onRemoveVariable={() => undefined}
        onRenameFile={() => undefined}
        onToggleEditing={() => undefined}
        onUpdateVariable={() => undefined}
        ready
        variables={variables}
      />
    </WithWindowToolbar>
  );
}

test("edit-mode env quick-add saves only the added row", async () => {
  const view = render(<EnvFileHarness />);
  fireEvent.click(view.getByRole("button", { name: "Add Variable" }));
  fireEvent.change(view.getByLabelText("Quick add env variable key"), {
    target: { value: "API_TOKEN" },
  });
  fireEvent.click(view.getByRole("button", { name: "Save Variable" }));

  await waitFor(() =>
    expect(
      view.getByRole("button", { name: "Env variable 2 actions" }),
    ).toBeTruthy(),
  );
  expect(view.queryByLabelText("Env variable 2 key")).toBeNull();
  expect(view.getByLabelText("Env variable 1 key")).toBeTruthy();
});

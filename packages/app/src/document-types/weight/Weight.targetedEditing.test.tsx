import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { WithWindowToolbar } from "../../../test/helpers/windowToolbarProbe";
import { useTargetedTrackerEditing } from "../shared/useTargetedTrackerEditing";
import { WeightFields } from "./Weight";
import type { WeightEntryRow } from "./weightEntries";

afterEach(cleanup);

function makeEntry(id: string, weight: string): WeightEntryRow {
  return {
    id,
    weight,
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
  };
}

function StatefulWeightFields() {
  const { editingRowId, enterRowEdit, isEditing, toggleEditing } =
    useTargetedTrackerEditing(true);

  return (
    <>
      <button type="button" onClick={() => enterRowEdit?.("e2")}>
        Retarget Entry 2
      </button>
      <WithWindowToolbar>
        <WeightFields
          editingEntryId={editingRowId}
          entries={[makeEntry("e1", "180.5"), makeEntry("e2", "179")]}
          isEditing={isEditing}
          onAddEntry={() => Promise.resolve("new-entry")}
          onChangeUnit={() => undefined}
          onEnterEdit={enterRowEdit}
          onRemoveEntry={() => undefined}
          onRenameTracker={() => undefined}
          onToggleEditing={toggleEditing}
          onUpdateEntry={() => undefined}
          ready
          trackerName="Morning weigh-ins"
          trackerNameInputId="weight-name"
          unit="lb"
          unitInputId="weight-unit"
        />
      </WithWindowToolbar>
    </>
  );
}

test("row and toolbar actions wire through targeted edit state", async () => {
  const view = render(<StatefulWeightFields />);

  fireEvent.click(view.getByRole("button", { name: "Entry 1 actions" }));
  fireEvent.click(view.getByRole("button", { name: "Edit" }));
  expect(view.getByLabelText("Entry 1 weight")).toBeTruthy();
  expect(view.queryByLabelText("Entry 2 weight")).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Retarget Entry 2" }));
  expect(view.queryByLabelText("Entry 1 weight")).toBeNull();
  expect(view.getByLabelText("Entry 2 weight")).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: "Toolbar Save" }));
  expect(view.queryByLabelText("Entry 1 weight")).toBeNull();
  expect(view.queryByLabelText("Entry 2 weight")).toBeNull();

  await waitFor(() => {
    expect(view.getByRole("button", { name: "Toolbar Edit" })).toBeTruthy();
  });
  fireEvent.click(view.getByRole("button", { name: "Toolbar Edit" }));
  expect(view.getByLabelText("Entry 1 weight")).toBeTruthy();
  expect(view.getByLabelText("Entry 2 weight")).toBeTruthy();
});

test("saving one row in a full-document session leaves its sibling editable", () => {
  const view = render(
    <WithWindowToolbar>
      <WeightFields
        entries={[makeEntry("e1", "180.5"), makeEntry("e2", "179")]}
        isEditing
        onAddEntry={() => Promise.resolve("new-entry")}
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
    </WithWindowToolbar>,
  );

  fireEvent.click(view.getByRole("button", { name: "Save entry 1" }));
  expect(view.queryByLabelText("Entry 1 weight")).toBeNull();
  expect(view.getByLabelText("Entry 2 weight")).toBeTruthy();
});

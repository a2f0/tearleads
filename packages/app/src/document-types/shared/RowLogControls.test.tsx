import { afterEach, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { VEHICLE_SERVICE_LOG } from "../vehicle/vehicleServiceLog";
import { RowLogEditRow, type RowLogEntry } from "./RowLogControls";

afterEach(cleanup);

function entry(cells: Record<string, string>): RowLogEntry {
  return {
    cells,
    createdAt: "2026-03-01T09:00:00.000Z",
    createdBy: "user-1",
    createdByPeer: null,
    fieldEditors: {},
    id: "service-1",
    updatedAt: "2026-03-01T09:00:00.000Z",
    updatedBy: "user-1",
    updatedByPeer: null,
  };
}

function renderEditRow(cells: Record<string, string>) {
  const view = render(
    <RowLogEditRow
      controlsDisabled={false}
      definition={VEHICLE_SERVICE_LOG}
      entry={entry(cells)}
      index={0}
      onRemove={() => undefined}
      onSave={() => undefined}
      onUpdate={() => undefined}
    />,
  );
  return within(view.container);
}

test("a saved row whose required cell is cleared holds Save but not Remove", () => {
  const view = renderEditRow({ serviceDate: "2026-03-01", work: "" });
  const work = view.getByLabelText("Service 1 work performed");
  expect(work.getAttribute("aria-invalid")).toBe("true");
  expect(
    view.getByRole<HTMLButtonElement>("button", { name: "Save service 1" })
      .disabled,
  ).toBe(true);
  expect(
    view.getByRole<HTMLButtonElement>("button", { name: "Remove service 1" })
      .disabled,
  ).toBe(false);

  cleanup();
  const filled = renderEditRow({ serviceDate: "2026-03-01", work: "Tires" });
  expect(
    filled.getByRole<HTMLButtonElement>("button", { name: "Save service 1" })
      .disabled,
  ).toBe(false);
});

test("a synced unit the list lacks shows as itself and is flagged", () => {
  const view = renderEditRow({ odometerUnit: "miles", work: "Tires" });
  const unit = view.getByRole<HTMLSelectElement>("combobox", {
    name: "Service 1 unit",
  });
  expect(unit.value).toBe("miles");
  expect(unit.getAttribute("aria-invalid")).toBe("true");
  expect(Array.from(unit.options).map((option) => option.textContent)).toEqual([
    "",
    "miles",
    "mi",
    "km",
  ]);
});

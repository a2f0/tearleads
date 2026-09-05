import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { WithWindowToolbar } from "../../../test/helpers/windowToolbarProbe";
import {
  APPLIANCE_TYPE_OPTIONS,
  applianceDocumentProjectorDefinition,
} from "../appliance/applianceDocumentDefinition";
import {
  EquipmentDocumentFieldsPane,
  EquipmentFields,
} from "./EquipmentDocument";
import type { EquipmentDocumentFields } from "./equipmentDocumentDefinition";

afterEach(cleanup);

const fields: EquipmentDocumentFields = {
  equipmentType: "dishwasher",
  make: "Bosch",
  model: "SHPM88Z75N",
  serialNumber: "FD9912345678",
};

const inputIds = {
  make: "appliance-make",
  model: "appliance-model",
  serialNumber: "appliance-serial-number",
};

function renderEquipmentFields(
  overrides: Partial<Parameters<typeof EquipmentFields>[0]> = {},
) {
  return render(
    <EquipmentFields
      ariaLabelPrefix="Appliance"
      fields={fields}
      inputIds={inputIds}
      isEditing={false}
      onChange={() => undefined}
      ready
      typeOptions={APPLIANCE_TYPE_OPTIONS}
      {...overrides}
    />,
  );
}

test("read mode shows the type's label and no editable controls", () => {
  const view = renderEquipmentFields();

  expect(view.getByText("Dishwasher")).toBeTruthy();
  expect(view.queryByText("dishwasher")).toBeNull();
  expect(view.getByText("Bosch")).toBeTruthy();
  expect(view.getByText("SHPM88Z75N")).toBeTruthy();
  expect(view.getByText("FD9912345678")).toBeTruthy();
  expect(view.queryByLabelText("Appliance type")).toBeNull();
  expect(view.queryByLabelText("Appliance make")).toBeNull();
});

test("read mode reports an unselected type as empty", () => {
  const view = renderEquipmentFields({
    fields: { ...fields, equipmentType: "" },
  });

  expect(view.getByText("None")).toBeTruthy();
});

// The type control is the shared themed select menu, not a native <select>:
// a combobox trigger opening a listbox of options.
function getTypeMenu(view: ReturnType<typeof render>): HTMLButtonElement {
  return view.getByRole("combobox", {
    name: "Appliance type",
  }) as HTMLButtonElement;
}

function listTypeOptionLabels(view: ReturnType<typeof render>): string[] {
  return view
    .getAllByRole("option")
    .map((option) => option.textContent?.trim() ?? "");
}

test("edit mode offers the hard-coded type list in a themed dropdown", () => {
  const patches: Array<Partial<EquipmentDocumentFields>> = [];
  const view = renderEquipmentFields({
    isEditing: true,
    onChange: (next) => {
      patches.push(next);
    },
  });

  const trigger = getTypeMenu(view);
  expect(trigger.textContent).toContain("Dishwasher");
  expect(view.container.querySelector("select")).toBeNull();
  expect(
    (view.getByLabelText("Appliance make") as HTMLInputElement).value,
  ).toBe("Bosch");

  fireEvent.click(trigger);
  expect(listTypeOptionLabels(view)).toEqual(
    APPLIANCE_TYPE_OPTIONS.map((option) => option.label),
  );

  const refrigerator = view
    .getByText("Refrigerator")
    .closest('[role="option"]');
  if (!(refrigerator instanceof HTMLElement)) {
    throw new Error("Expected the Refrigerator option.");
  }
  fireEvent.click(refrigerator);

  expect(patches).toEqual([{ equipmentType: "refrigerator" }]);
});

test("edit mode shows a placeholder until a type is chosen", () => {
  const view = renderEquipmentFields({
    fields: { ...fields, equipmentType: "" },
    isEditing: true,
  });

  expect(getTypeMenu(view).textContent).toContain("Select a type");
});

test("edit mode keeps a stored type that is not in this client's list", () => {
  const view = renderEquipmentFields({
    fields: { ...fields, equipmentType: "wine_cooler" },
    isEditing: true,
  });

  const trigger = getTypeMenu(view);
  expect(trigger.textContent).toContain("Wine Cooler");

  fireEvent.click(trigger);
  expect(listTypeOptionLabels(view)[0]).toBe("Wine Cooler");
});

test("whitespace around a stored type does not duplicate its option", () => {
  const view = renderEquipmentFields({
    fields: { ...fields, equipmentType: " dryer " },
    isEditing: true,
  });

  const trigger = getTypeMenu(view);
  expect(trigger.textContent).toContain("Dryer");

  fireEvent.click(trigger);
  const labels = listTypeOptionLabels(view);
  expect(labels).toHaveLength(APPLIANCE_TYPE_OPTIONS.length);
  expect(labels.filter((label) => label === "Dryer")).toHaveLength(1);
});

test("edit toggle lives in the toolbar, not the document body", () => {
  let toggles = 0;
  const view = render(
    <WithWindowToolbar>
      <EquipmentDocumentFieldsPane
        canWrite
        definition={applianceDocumentProjectorDefinition}
        fields={fields}
        inputIds={inputIds}
        isEditing={false}
        onToggleEditing={() => {
          toggles += 1;
        }}
        ready
        setStructuredFields={async () => undefined}
      />
    </WithWindowToolbar>,
  );

  expect(view.queryByRole("button", { name: "Edit" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Toolbar Edit" }));

  expect(toggles).toBe(1);
});

test("toolbar edit action reads Done while editing", () => {
  const view = render(
    <WithWindowToolbar>
      <EquipmentDocumentFieldsPane
        canWrite
        definition={applianceDocumentProjectorDefinition}
        fields={fields}
        inputIds={inputIds}
        isEditing
        onToggleEditing={() => undefined}
        ready
        setStructuredFields={async () => undefined}
      />
    </WithWindowToolbar>,
  );

  expect(view.getByRole("button", { name: "Toolbar Done" })).toBeTruthy();
});

test("field edits are written under the definition's kind", () => {
  const writes: Array<[string, Partial<EquipmentDocumentFields>]> = [];
  const view = render(
    <WithWindowToolbar>
      <EquipmentDocumentFieldsPane
        canWrite
        definition={applianceDocumentProjectorDefinition}
        fields={fields}
        inputIds={inputIds}
        isEditing
        onToggleEditing={() => undefined}
        ready
        setStructuredFields={async (kind, patch) => {
          writes.push([kind, patch]);
        }}
      />
    </WithWindowToolbar>,
  );

  fireEvent.change(view.getByLabelText("Appliance serial number"), {
    target: { value: "SN-1" },
  });

  expect(writes).toEqual([["appliance", { serialNumber: "SN-1" }]]);
});

test("toolbar edit action is disabled without write access", () => {
  const view = render(
    <WithWindowToolbar>
      <EquipmentDocumentFieldsPane
        canWrite={false}
        definition={applianceDocumentProjectorDefinition}
        fields={fields}
        inputIds={inputIds}
        isEditing={false}
        onToggleEditing={() => undefined}
        ready
        setStructuredFields={async () => undefined}
      />
    </WithWindowToolbar>,
  );

  expect(
    (view.getByRole("button", { name: "Toolbar Edit" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

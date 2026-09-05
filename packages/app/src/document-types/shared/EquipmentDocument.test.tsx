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
  equipmentType: "appliance-type",
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

test("edit mode offers the hard-coded type list in a dropdown", () => {
  const patches: Array<Partial<EquipmentDocumentFields>> = [];
  const view = renderEquipmentFields({
    isEditing: true,
    onChange: (next) => {
      patches.push(next);
    },
  });

  const select = view.getByLabelText("Appliance type") as HTMLSelectElement;
  expect(select.value).toBe("dishwasher");
  expect(Array.from(select.options).map((option) => option.value)).toEqual([
    "",
    ...APPLIANCE_TYPE_OPTIONS.map((option) => option.value),
  ]);
  expect(
    (view.getByLabelText("Appliance make") as HTMLInputElement).value,
  ).toBe("Bosch");

  fireEvent.change(select, { target: { value: "refrigerator" } });

  expect(patches).toEqual([{ equipmentType: "refrigerator" }]);
});

test("edit mode keeps a stored type that is not in this client's list", () => {
  const view = renderEquipmentFields({
    fields: { ...fields, equipmentType: "wine_cooler" },
    isEditing: true,
  });

  const select = view.getByLabelText("Appliance type") as HTMLSelectElement;
  expect(select.value).toBe("wine_cooler");
  expect(select.selectedOptions[0]?.textContent).toBe("Wine Cooler");
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

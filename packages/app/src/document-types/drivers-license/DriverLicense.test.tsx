import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { WithWindowToolbar } from "../../../test/helpers/windowToolbarProbe";
import {
  DriverLicenseDocumentFieldsPane,
  DriverLicenseFields,
} from "./DriverLicense";
import type { DriverLicenseDocumentFields } from "./driverLicenseDocumentDefinition";

afterEach(cleanup);

const fields: DriverLicenseDocumentFields = {
  expirationDate: "2030-05-20",
  licenseId: "DL-1234567",
};

const inputIds = {
  expirationDate: "license-expiration-date",
  licenseId: "license-id",
};

function renderDriverLicenseFields(
  overrides: Partial<Parameters<typeof DriverLicenseFields>[0]> = {},
) {
  return render(
    <DriverLicenseFields
      fields={fields}
      inputIds={inputIds}
      isEditing={false}
      onChange={() => undefined}
      ready
      {...overrides}
    />,
  );
}

test("read mode renders driver's license details without editable inputs", () => {
  const view = renderDriverLicenseFields();

  expect(view.getByText("DL-1234567")).toBeTruthy();
  expect(view.getByText("2030-05-20")).toBeTruthy();
  expect(view.queryByLabelText("Driver's license ID number")).toBeNull();
  expect(view.queryByLabelText("Driver's license expiration date")).toBeNull();
});

test("edit mode exposes the existing driver's license controls", () => {
  const view = renderDriverLicenseFields({ isEditing: true });

  expect(
    (view.getByLabelText("Driver's license ID number") as HTMLInputElement)
      .value,
  ).toBe("DL-1234567");
  expect(
    (
      view.getByLabelText(
        "Driver's license expiration date",
      ) as HTMLInputElement
    ).value,
  ).toBe("2030-05-20");
});

test("edit toggle lives in the toolbar, not the document body", () => {
  let toggles = 0;
  const view = render(
    <WithWindowToolbar>
      <DriverLicenseDocumentFieldsPane
        canWrite
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
      <DriverLicenseDocumentFieldsPane
        canWrite
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

test("toolbar edit action is disabled without write access", () => {
  const view = render(
    <WithWindowToolbar>
      <DriverLicenseDocumentFieldsPane
        canWrite={false}
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

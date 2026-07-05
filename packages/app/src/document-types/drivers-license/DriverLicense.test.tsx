import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { DriverLicenseFields } from "./DriverLicense";
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

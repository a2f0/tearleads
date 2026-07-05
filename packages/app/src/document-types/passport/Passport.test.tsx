import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { PassportFields } from "./Passport";
import type { PassportDocumentFields } from "./passportDocument";

afterEach(cleanup);

const fields: PassportDocumentFields = {
  expirationDate: "2032-10-15",
  fullName: "Ada Lovelace",
  issuingCountry: "United Kingdom",
  passportNumber: "P1234567",
};

const inputIds = {
  expirationDate: "passport-expiration-date",
  fullName: "passport-full-name",
  issuingCountry: "passport-issuing-country",
  passportNumber: "passport-number",
};

function renderPassportFields(
  overrides: Partial<Parameters<typeof PassportFields>[0]> = {},
) {
  return render(
    <PassportFields
      fields={fields}
      inputIds={inputIds}
      isEditing={false}
      onChange={() => undefined}
      ready
      {...overrides}
    />,
  );
}

test("read mode renders passport details without editable inputs", () => {
  const view = renderPassportFields();

  expect(view.getByText("Ada Lovelace")).toBeTruthy();
  expect(view.getByText("P1234567")).toBeTruthy();
  expect(view.getByText("United Kingdom")).toBeTruthy();
  expect(view.getByText("2032-10-15")).toBeTruthy();
  expect(view.queryByLabelText("Passport full name")).toBeNull();
  expect(view.queryByLabelText("Passport number")).toBeNull();
});

test("edit mode exposes the existing passport controls", () => {
  const view = renderPassportFields({ isEditing: true });

  expect(
    (view.getByLabelText("Passport full name") as HTMLInputElement).value,
  ).toBe("Ada Lovelace");
  expect(
    (view.getByLabelText("Passport number") as HTMLInputElement).value,
  ).toBe("P1234567");
});

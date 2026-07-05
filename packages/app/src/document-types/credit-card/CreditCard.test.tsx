import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { CreditCardFields } from "./CreditCard";
import type { CreditCardDocumentFields } from "./creditCardDocument";

afterEach(cleanup);

const fields: CreditCardDocumentFields = {
  cardNumber: "4111 1111 1111 1111",
  cvvCode: "123",
  expirationDate: "2028-04",
  nameOnCard: "Ada Lovelace",
};

const inputIds = {
  cardNumber: "card-number",
  cvvCode: "cvv-code",
  expirationDate: "expiration-date",
  nameOnCard: "name-on-card",
};

function renderCreditCardFields(
  overrides: Partial<Parameters<typeof CreditCardFields>[0]> = {},
) {
  return render(
    <CreditCardFields
      fields={fields}
      inputIds={inputIds}
      isEditing={false}
      onChange={() => undefined}
      ready
      {...overrides}
    />,
  );
}

test("read mode renders masked card details without editable inputs", () => {
  const view = renderCreditCardFields();

  expect(view.getByText("**** **** **** 1111")).toBeTruthy();
  expect(view.getByText("Ada Lovelace")).toBeTruthy();
  expect(view.getByText("2028-04")).toBeTruthy();
  expect(view.getByText("***")).toBeTruthy();
  expect(view.queryByLabelText("Credit card number")).toBeNull();
  expect(view.queryByLabelText("Credit card CVV code")).toBeNull();
});

test("read mode tolerates missing card details", () => {
  const view = renderCreditCardFields({
    fields: {
      cardNumber: undefined as unknown as string,
      cvvCode: null as unknown as string,
      expirationDate: undefined as unknown as string,
      nameOnCard: null as unknown as string,
    },
  });

  expect(view.getAllByText("None")).toHaveLength(4);
  expect(view.queryByLabelText("Credit card number")).toBeNull();
});

test("edit mode exposes the existing credit card controls", () => {
  const view = renderCreditCardFields({ isEditing: true });

  expect(
    (view.getByLabelText("Credit card number") as HTMLInputElement).value,
  ).toBe("4111 1111 1111 1111");
  expect(
    (view.getByLabelText("Credit card CVV code") as HTMLInputElement).value,
  ).toBe("123");
});

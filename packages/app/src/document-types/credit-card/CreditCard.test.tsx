import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { WithWindowToolbar } from "../../../test/helpers/windowToolbarProbe";
import { CreditCardDocumentFieldsPane, CreditCardFields } from "./CreditCard";
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

test("read mode reveals the card number and CVV independently", () => {
  const view = renderCreditCardFields();

  fireEvent.click(view.getByLabelText("Show credit card number"));

  expect(view.getByText("4111 1111 1111 1111")).toBeTruthy();
  expect(view.getByText("***")).toBeTruthy();

  fireEvent.click(view.getByLabelText("Show credit card CVV code"));

  expect(view.getByText("123")).toBeTruthy();
  expect(view.queryByText("**** **** **** 1111")).toBeNull();
});

test("read mode re-masks a revealed card number", () => {
  const view = renderCreditCardFields();

  fireEvent.click(view.getByLabelText("Show credit card number"));
  fireEvent.click(view.getByLabelText("Hide credit card number"));

  expect(view.getByText("**** **** **** 1111")).toBeTruthy();
  expect(view.queryByText("4111 1111 1111 1111")).toBeNull();
});

test("read mode omits reveal toggles for missing card details", () => {
  const view = renderCreditCardFields({
    fields: {
      cardNumber: undefined as unknown as string,
      cvvCode: null as unknown as string,
      expirationDate: undefined as unknown as string,
      nameOnCard: null as unknown as string,
    },
  });

  expect(view.queryByLabelText("Show credit card number")).toBeNull();
  expect(view.queryByLabelText("Show credit card CVV code")).toBeNull();
});

test("edit mode toggles the sensitive inputs between password and text", () => {
  const view = renderCreditCardFields({ isEditing: true });
  const cardNumber = view.getByLabelText(
    "Credit card number",
  ) as HTMLInputElement;
  const cvvCode = view.getByLabelText(
    "Credit card CVV code",
  ) as HTMLInputElement;

  expect(cardNumber.type).toBe("password");
  expect(cvvCode.type).toBe("password");

  fireEvent.click(view.getByLabelText("Show credit card number"));
  fireEvent.click(view.getByLabelText("Show credit card CVV code"));

  expect(cardNumber.type).toBe("text");
  expect(cvvCode.type).toBe("text");
});

test("edit mode reveal toggles follow the disabled state", () => {
  const view = renderCreditCardFields({ disabled: true, isEditing: true });

  expect(
    (view.getByLabelText("Show credit card number") as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

test("edit toggle lives in the toolbar, not the document body", () => {
  let toggles = 0;
  const view = render(
    <WithWindowToolbar>
      <CreditCardDocumentFieldsPane
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
      <CreditCardDocumentFieldsPane
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
      <CreditCardDocumentFieldsPane
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

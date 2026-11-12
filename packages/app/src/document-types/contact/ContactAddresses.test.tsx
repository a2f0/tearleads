import { afterEach, expect, mock, test } from "bun:test";
import type { DocumentRow } from "@tearleads/client-sdk";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { ContactAddresses } from "./ContactAddresses";
import type { ContactAddressFields } from "./contactAddressModel";

afterEach(cleanup);

function address(
  id = "address-home",
  fields: Record<string, string> = {},
): DocumentRow {
  return {
    id,
    fields: {
      recordType: "postalAddress",
      label: "Home",
      street: "12 Example St",
      postalCode: "00123",
      ...fields,
    },
    createdAt: "2026-01-01T12:00:00Z",
    createdBy: "self-attested-impostor",
    createdByPeer: "creator-peer",
    updatedAt: "2026-01-02T12:00:00Z",
    updatedBy: "self-attested-impostor",
    updatedByPeer: "editor-peer",
    fieldEditors: { street: "street-peer" },
  };
}

function props(rows: ReadonlyArray<DocumentRow> | undefined = [address()]) {
  return {
    rows,
    disabled: false,
    isEditing: false,
    currentAuthorId: "local-user",
    onAddAddress: mock(
      async (
        _fields: ContactAddressFields,
        _intent: object,
        _isCurrent?: () => boolean,
      ) => "new-address" as string | null,
    ),
    onUpdateAddress: mock(
      async (
        _id: string,
        _patch: Partial<ContactAddressFields>,
        _isCurrent?: () => boolean,
      ) => undefined,
    ),
    onRemoveAddress: mock(
      async (_id: string, _isCurrent?: () => boolean) => undefined,
    ),
  };
}

test("unhydrated rows show loading rather than an empty address list", () => {
  const view = render(
    <ContactAddresses {...props(undefined)} rows={undefined} isEditing />,
  );
  expect(view.getByText("Loading addresses…")).toBeTruthy();
  expect(view.queryByText("No addresses.")).toBeNull();
  expect(view.queryByRole("button", { name: "Add address" })).toBeNull();
  view.rerender(<ContactAddresses {...props([])} />);
  expect(view.getByText("No addresses.")).toBeTruthy();
});

test("editing patches the stable row ID without replaying remotely changed cells", async () => {
  const input = props();
  const view = render(<ContactAddresses {...input} isEditing />);
  fireEvent.click(view.getByRole("button", { name: "Edit address" }));
  fireEvent.change(view.getByLabelText("Street address"), {
    target: { value: "34 New Street" },
  });
  view.rerender(
    <ContactAddresses
      {...input}
      isEditing
      disabled
      rows={[
        address("other", { label: "Work" }),
        address("address-home", { postalCode: "00999" }),
      ]}
    />,
  );
  expect(
    (view.getByLabelText("Street address") as HTMLInputElement).value,
  ).toBe("34 New Street");
  fireEvent.click(view.getByRole("button", { name: "Save address" }));
  expect(input.onUpdateAddress).not.toHaveBeenCalled();
  view.rerender(
    <ContactAddresses
      {...input}
      isEditing
      rows={[
        address("other", { label: "Work" }),
        address("address-home", { postalCode: "00999" }),
      ]}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Save address" }));
  await waitFor(() =>
    expect(input.onUpdateAddress).toHaveBeenCalledWith(
      "address-home",
      {
        street: "34 New Street",
      },
      expect.any(Function),
    ),
  );
  await waitFor(() =>
    expect(view.queryByLabelText("Street address")).toBeNull(),
  );
});

test("adding requires address content and preserves a refused draft for retry", async () => {
  const input = props([]);
  let finish: (id: string | null) => void = () => undefined;
  input.onAddAddress.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<ContactAddresses {...input} isEditing />);
  fireEvent.click(view.getByRole("button", { name: "Add address" }));
  fireEvent.change(view.getByLabelText("Label"), { target: { value: "Home" } });
  fireEvent.click(view.getByRole("button", { name: "Save address" }));
  expect(input.onAddAddress).not.toHaveBeenCalled();
  expect(view.getByRole("alert").textContent).toContain(
    "Enter at least one address field",
  );
  fireEvent.change(view.getByLabelText("Postal code"), {
    target: { value: " 00123 " },
  });
  fireEvent.click(view.getByRole("button", { name: "Save address" }));
  fireEvent.click(view.getByRole("button", { name: "Save address" }));
  await waitFor(() => expect(input.onAddAddress).toHaveBeenCalledTimes(1));
  expect(input.onAddAddress.mock.calls[0]).toEqual([
    {
      label: "Home",
      street: "",
      extendedAddress: "",
      locality: "",
      region: "",
      postalCode: "00123",
      countryCode: "",
    },
    expect.any(Object),
    expect.any(Function),
  ]);
  finish(null);
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain(
      "Address was not saved",
    ),
  );
  expect((view.getByLabelText("Postal code") as HTMLInputElement).value).toBe(
    " 00123 ",
  );
  fireEvent.click(view.getByRole("button", { name: "Save address" }));
  await waitFor(() =>
    expect(view.queryByRole("form", { name: "Address editor" })).toBeNull(),
  );
});

test("removing targets its stable ID and keeps failures visible", async () => {
  const input = props([address(), address("work", { label: "Work" })]);
  input.onRemoveAddress.mockRejectedValueOnce(
    new Error("Address could not be removed."),
  );
  const view = render(<ContactAddresses {...input} isEditing />);
  fireEvent.click(
    within(view.getByRole("group", { name: "Work" })).getByRole("button", {
      name: "Remove address",
    }),
  );
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toBe(
      "Address could not be removed.",
    ),
  );
  expect(input.onRemoveAddress).toHaveBeenCalledWith(
    "work",
    expect.any(Function),
  );
  expect(view.getByRole("group", { name: "Home" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Retry address removal" }));
  await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
  expect(input.onRemoveAddress).toHaveBeenCalledTimes(2);
});

test("cancel discards the draft without writing", () => {
  const input = props();
  const view = render(<ContactAddresses {...input} isEditing />);
  fireEvent.click(view.getByRole("button", { name: "Edit address" }));
  fireEvent.change(view.getByLabelText("Street address"), {
    target: { value: "Discarded" },
  });
  fireEvent.click(view.getByRole("button", { name: "Cancel address editing" }));
  expect(view.queryByLabelText("Street address")).toBeNull();
  expect(input.onUpdateAddress).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Edit address" }));
  expect(
    (view.getByLabelText("Street address") as HTMLInputElement).value,
  ).toBe("12 Example St");
});

test("a remotely removed address cannot be saved from its retained draft", async () => {
  const input = props();
  const view = render(<ContactAddresses {...input} isEditing />);
  fireEvent.click(view.getByRole("button", { name: "Edit address" }));
  fireEvent.change(view.getByLabelText("Street address"), {
    target: { value: "Retained draft" },
  });
  view.rerender(<ContactAddresses {...input} isEditing rows={[]} />);
  fireEvent.click(view.getByRole("button", { name: "Save address" }));
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain(
      "no longer available",
    ),
  );
  expect(input.onUpdateAddress).not.toHaveBeenCalled();
  expect(
    (view.getByLabelText("Street address") as HTMLInputElement).value,
  ).toBe("Retained draft");
});

test("saving an unchanged draft does not restamp any address cells", async () => {
  const input = props();
  const view = render(<ContactAddresses {...input} isEditing />);
  fireEvent.click(view.getByRole("button", { name: "Edit address" }));
  fireEvent.click(view.getByRole("button", { name: "Save address" }));
  await waitFor(() =>
    expect(view.queryByRole("form", { name: "Address editor" })).toBeNull(),
  );
  expect(input.onUpdateAddress).not.toHaveBeenCalled();
});

test("address cards retain postal strings and omit unknown row kinds", () => {
  const view = render(
    <ContactAddresses
      {...props([
        address(),
        address("future", {
          recordType: "future",
          street: "Hidden future content",
        }),
      ])}
    />,
  );
  const card = within(view.getByRole("group", { name: "Home" }));
  expect(card.getByText("Street address")).toBeTruthy();
  expect(card.getByText("12 Example St")).toBeTruthy();
  expect(card.getByText("00123")).toBeTruthy();
  expect(view.queryByText("Hidden future content")).toBeNull();
  expect(view.queryByRole("button", { name: "Add address" })).toBeNull();
  fireEvent.click(card.getByRole("button", { name: "Details / attribution" }));
  expect(view.getByRole("dialog", { name: "Home — attribution" })).toBeTruthy();
  expect(view.queryByText(/self-attested-impostor/)).toBeNull();
});

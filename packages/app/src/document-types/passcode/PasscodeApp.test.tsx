import { afterEach, expect, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  generateIdentityAndWaitForDb,
  openExplorer,
  openExplorerNewStructuredDocumentRoute,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
} from "../../../test/helpers/paneTestUtils";
import { PasscodeAttributesEditor } from "./PasscodeAttributesEditor";
import { PasscodeEditView } from "./PasscodeEditView";
import { PasscodeReadView } from "./PasscodeReadView";
import { PASSCODE_MASK } from "./PasscodeValues";
import type { PasscodeAttribute } from "./passcodeAttributes";
import {
  type PasscodeDocumentFields,
  readPasscodeFieldValues,
} from "./passcodeDocumentDefinition";

afterEach(async () => {
  cleanup();
  await cleanupPaneTestEnvironment();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

const fields: PasscodeDocumentFields = {
  ...readPasscodeFieldValues({}),
  notes: "line one\nline two",
  password: "s3cret-Ω",
  sourceId: "bWFpbGVudHJ5dXVpZDAwMQ==",
  title: "Mail",
  url: "https://mail.example.com",
  username: "alice@example.com",
};

const attributes: PasscodeAttribute[] = [
  { id: "a", isProtected: true, name: "PIN", value: "4321" },
  { id: "b", isProtected: false, name: "Account", value: "12-34" },
];

// The control a label names, as the input it must be.
function inputLabelled(
  scope: { getByLabelText: (label: string) => HTMLElement },
  label: string,
): HTMLInputElement {
  const control = scope.getByLabelText(label);
  if (!(control instanceof HTMLInputElement)) {
    throw new Error(`${label} is not an input.`);
  }
  return control;
}

function rowText(view: ReturnType<typeof render>, label: string) {
  return view.getByText(label).closest(".mini-app-key-value-row")?.textContent;
}

test("read mode masks the password and protected attributes until revealed", () => {
  const view = render(
    <PasscodeReadView attributes={attributes} fields={fields} />,
  );

  expect(rowText(view, "Password")).toContain(PASSCODE_MASK);
  expect(view.queryByText("s3cret-Ω")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Show password" }));
  expect(view.getByText("s3cret-Ω")).toBeTruthy();
  expect(
    view
      .getByRole("button", { name: "Hide password" })
      .getAttribute("aria-pressed"),
  ).toBe("true");

  expect(rowText(view, "PIN")).toContain(PASSCODE_MASK);
  expect(rowText(view, "Account")).toContain("12-34");
  fireEvent.click(view.getByRole("button", { name: "Show PIN value" }));
  expect(rowText(view, "PIN")).toContain("4321");

  expect(rowText(view, "Expires")).toContain("Never");
  expect(rowText(view, "Source ID")).toContain("bWFpbGVudHJ5dXVpZDAwMQ==");
  // Blank optional rows are left out rather than shown empty.
  expect(view.queryByText("TOTP")).toBeNull();
  expect(view.queryByText("Tags")).toBeNull();
});

test("edit mode writes each field and masks the password input", () => {
  const patches: Array<Partial<PasscodeDocumentFields>> = [];
  const view = render(
    <PasscodeEditView
      attributeOperations={{
        addRow: () => undefined,
        removeRow: () => undefined,
        updateRow: () => undefined,
      }}
      attributes={[]}
      disabled={false}
      fields={fields}
      onChange={(patch) => patches.push(patch)}
      ready
    />,
  );

  const password = inputLabelled(view, "Password");
  expect(password.type).toBe("password");
  fireEvent.click(view.getByRole("button", { name: "Show password" }));
  expect(password.type).toBe("text");
  fireEvent.change(password, { target: { value: "new-secret" } });
  fireEvent.change(view.getByLabelText("Username"), {
    target: { value: "bob" },
  });
  fireEvent.change(view.getByLabelText("Expires"), {
    target: { value: "2027-01-31" },
  });
  fireEvent.change(view.getByLabelText("Notes"), {
    target: { value: "note" },
  });
  expect(patches).toEqual([
    { password: "new-secret" },
    { username: "bob" },
    { expirationDate: "2027-01-31" },
    { notes: "note" },
  ]);
  expect(inputLabelled(view, "TOTP").type).toBe("password");
  // The source fields are shown, never offered for editing.
  expect(view.queryByRole("textbox", { name: "Source ID" })).toBeNull();
});

test("the attribute editor adds, renames, protects, and removes rows", () => {
  const calls: unknown[] = [];
  const view = render(
    <PasscodeAttributesEditor
      attributes={attributes}
      disabled={false}
      operations={{
        addRow: (cells) => calls.push(["add", cells]),
        removeRow: (id) => calls.push(["remove", id]),
        updateRow: (id, field, value) =>
          calls.push(["update", id, field, value]),
      }}
    />,
  );

  expect(inputLabelled(view, "Attribute 1 value").type).toBe("password");
  expect(inputLabelled(view, "Attribute 2 value").type).toBe("text");
  fireEvent.change(view.getByLabelText("Attribute 2 name"), {
    target: { value: "Account number" },
  });
  fireEvent.click(view.getByLabelText("Attribute 2 protected"));
  fireEvent.click(view.getByRole("button", { name: "Remove attribute 1" }));
  fireEvent.click(view.getByRole("button", { name: "Add Attribute" }));
  expect(calls).toEqual([
    ["update", "b", "name", "Account number"],
    ["update", "b", "protected", "true"],
    ["remove", "a"],
    ["add", { name: "Attribute 3", protected: "", value: "" }],
  ]);
});

test(
  "Explorer creates a passcode whose password and protected attribute stay masked",
  async () => {
    const view = renderPane();
    await generateIdentityAndWaitForDb(view);
    const explorer = await openExplorer(view);
    const panel = within(explorer);
    await openExplorerNewStructuredDocumentRoute(explorer);
    fireEvent.click(panel.getByRole("button", { name: "Passcode" }));

    const title = await waitFor(() => {
      const control = panel.getByRole<HTMLInputElement>("textbox", {
        name: "Title",
      });
      expect(control.disabled).toBe(false);
      return control;
    });
    fireEvent.change(title, { target: { value: "Router" } });
    const password = inputLabelled(panel, "Password");
    fireEvent.change(password, { target: { value: "hunter2" } });
    await waitFor(() => expect(password.value).toBe("hunter2"));
    fireEvent.click(panel.getByRole("button", { name: "Add Attribute" }));
    const value = await waitFor(() =>
      inputLabelled(panel, "Attribute 1 value"),
    );
    fireEvent.change(value, { target: { value: "admin-pin" } });
    fireEvent.click(panel.getByLabelText("Attribute 1 protected"));
    await waitFor(() =>
      expect(inputLabelled(panel, "Attribute 1 value").type).toBe("password"),
    );

    fireEvent.click(panel.getByRole("button", { name: "Done" }));
    const entry = await panel.findByRole("group", { name: "Entry" });
    expect(within(entry).getByText("Router")).toBeTruthy();
    expect(within(entry).queryByText("hunter2")).toBeNull();
    expect(within(entry).getByText(PASSCODE_MASK)).toBeTruthy();
    const extra = panel.getByRole("group", { name: "Additional attributes" });
    expect(within(extra).queryByText("admin-pin")).toBeNull();
    fireEvent.click(
      within(extra).getByRole("button", { name: "Show Attribute 1 value" }),
    );
    expect(within(extra).getByText("admin-pin")).toBeTruthy();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

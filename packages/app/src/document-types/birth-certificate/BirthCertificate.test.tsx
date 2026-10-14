import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { WithWindowToolbar } from "../../../test/helpers/windowToolbarProbe";
import {
  BirthCertificateFields,
  BirthCertificateFieldsPane,
} from "./BirthCertificate";
import type { BirthCertificateDocumentFields } from "./birthCertificateDocumentDefinition";

afterEach(cleanup);
const fields: BirthCertificateDocumentFields = {
  certificateNumber: "BC-42",
  fullName: "Maya Elena Reyes",
  dateOfBirth: "1991-03-14",
  placeOfBirth: "Aurelia, Utopia",
  parentNames: "Rosa María Reyes",
  issuingAuthority: "Aurelia Civil Registry",
  dateIssued: "1991-03-20",
};

test("read mode shows every birth certificate field without inputs", () => {
  const view = render(
    <BirthCertificateFields
      fields={fields}
      isEditing={false}
      disabled={false}
      onChange={() => undefined}
    />,
  );
  for (const value of Object.values(fields))
    expect(view.getByText(value)).toBeTruthy();
  expect(view.queryByRole("textbox")).toBeNull();
});

test("editing changes only the selected field and uses date controls", () => {
  const patches: Partial<BirthCertificateDocumentFields>[] = [];
  const view = render(
    <BirthCertificateFields
      fields={fields}
      isEditing
      disabled={false}
      onChange={(patch) => patches.push(patch)}
    />,
  );
  fireEvent.change(view.getByLabelText("Birth certificate full name"), {
    target: { value: "Maya Reyes" },
  });
  fireEvent.change(view.getByLabelText("Birth certificate date of birth"), {
    target: { value: "1991-03-15" },
  });
  expect(patches).toEqual([
    { fullName: "Maya Reyes" },
    { dateOfBirth: "1991-03-15" },
  ]);
  expect(
    (view.getByLabelText("Birth certificate date issued") as HTMLInputElement)
      .type,
  ).toBe("date");
});

test("unavailable editing disables every field", () => {
  const view = render(
    <BirthCertificateFields
      fields={fields}
      isEditing
      disabled
      onChange={() => undefined}
    />,
  );
  const inputs = view.container.querySelectorAll("input");
  expect(inputs.length).toBe(7);
  for (const input of inputs) expect(input.disabled).toBe(true);
});

test("birth certificate write access controls the editor and toolbar", () => {
  const writes: unknown[] = [];
  let toggles = 0;
  const pane = (canWrite: boolean, ready = true) => (
    <WithWindowToolbar>
      <BirthCertificateFieldsPane
        fields={fields}
        isEditing
        canWrite={canWrite}
        ready={ready}
        onToggleEditing={() => {
          toggles += 1;
        }}
        setStructuredFields={async (kind, patch) => {
          writes.push({ kind, patch });
        }}
      />
    </WithWindowToolbar>
  );
  const view = render(pane(false));
  expect(view.queryByRole("textbox")).toBeNull();
  expect(
    (view.getByRole("button", { name: "Toolbar Done" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  view.rerender(pane(true, false));
  expect(
    (view.getByLabelText("Birth certificate full name") as HTMLInputElement)
      .disabled,
  ).toBe(true);
  view.rerender(pane(true));
  fireEvent.change(view.getByLabelText("Birth certificate full name"), {
    target: { value: "Maya Reyes" },
  });
  fireEvent.click(view.getByRole("button", { name: "Toolbar Done" }));
  expect(writes).toEqual([
    { kind: "birth_certificate", patch: { fullName: "Maya Reyes" } },
  ]);
  expect(toggles).toBe(1);
});

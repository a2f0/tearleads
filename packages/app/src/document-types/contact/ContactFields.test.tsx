import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ContactFields } from "./ContactFields";
import type {
  ContactFieldKey,
  ContactFieldValues,
} from "./contactFieldDescriptors";

afterEach(cleanup);

const values: ContactFieldValues = {
  encapsulationPublicKey: "public-key",
  firstName: "Ada",
  lastName: "Lovelace",
  nickname: "Countess",
  userId: "ada-user",
};

test("read mode shows values as text without editable inputs", () => {
  const view = render(
    <ContactFields
      isEditing={false}
      onFieldCommit={() => undefined}
      values={values}
    />,
  );

  expect(view.getByText("Countess")).toBeTruthy();
  expect(view.queryByLabelText("Nickname")).toBeNull();
});

test("read mode leaves out empty fields", () => {
  const view = render(
    <ContactFields
      isEditing={false}
      onFieldCommit={() => undefined}
      values={{ ...values, userId: "" }}
    />,
  );

  expect(view.queryByText("Tearleads user ID")).toBeNull();
  expect(view.queryByRole("button", { name: "Copy user ID" })).toBeNull();
  expect(view.getByText("Nickname")).toBeTruthy();
  expect(view.queryByText("None")).toBeNull();
});

test("read mode with no filled-in fields says so", () => {
  const view = render(
    <ContactFields
      isEditing={false}
      onFieldCommit={() => undefined}
      values={{
        encapsulationPublicKey: "",
        firstName: "",
        lastName: " ",
        nickname: "",
        userId: "",
      }}
    />,
  );

  expect(view.getByText("No details yet.")).toBeTruthy();
});

test("edit mode keeps empty fields so they can be filled in", () => {
  const view = render(
    <ContactFields
      isEditing={true}
      onFieldCommit={() => undefined}
      values={{ ...values, userId: "" }}
    />,
  );

  expect(view.getByLabelText("Tearleads user ID")).toBeTruthy();
});

test("edit mode exposes editable inputs seeded from values", () => {
  const view = render(
    <ContactFields
      isEditing={true}
      onFieldCommit={() => undefined}
      values={values}
    />,
  );

  expect((view.getByLabelText("Nickname") as HTMLInputElement).value).toBe(
    "Countess",
  );
});

test("edit mode commits a changed field on blur", () => {
  const commits: Array<{ key: ContactFieldKey; value: string }> = [];
  const view = render(
    <ContactFields
      isEditing={true}
      onFieldCommit={(key, value) => commits.push({ key, value })}
      values={values}
    />,
  );

  const nicknameInput = view.getByLabelText("Nickname") as HTMLInputElement;
  fireEvent.change(nicknameInput, { target: { value: "Ada" } });
  fireEvent.blur(nicknameInput);

  expect(commits).toEqual([{ key: "nickname", value: "Ada" }]);
});

test("edit mode disables inputs without leaving edit mode when disabled", () => {
  const view = render(
    <ContactFields
      disabled={true}
      isEditing={true}
      onFieldCommit={() => undefined}
      values={values}
    />,
  );

  const nicknameInput = view.getByLabelText("Nickname") as HTMLInputElement;
  expect(nicknameInput.value).toBe("Countess");
  expect(nicknameInput.disabled).toBe(true);
});

test("edit mode does not commit when a field is left unchanged on blur", () => {
  const commits: Array<{ key: ContactFieldKey; value: string }> = [];
  const view = render(
    <ContactFields
      isEditing={true}
      onFieldCommit={(key, value) => commits.push({ key, value })}
      values={values}
    />,
  );

  const nicknameInput = view.getByLabelText("Nickname") as HTMLInputElement;
  fireEvent.blur(nicknameInput);

  expect(commits).toEqual([]);
});

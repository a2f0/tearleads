import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { EnvFileFields, type EnvVariableRow } from "./EnvFile";
import { ENV_FILE_VARIABLE_NAME_PATTERN } from "./envFileDocumentDefinition";

afterEach(cleanup);

const variables: EnvVariableRow[] = [
  {
    id: "v1",
    key: "API_URL",
    value: "https://api.example.test",
    updatedAt: "2026-07-16T08:30:00.000Z",
    updatedBy: "user-alice",
  },
  {
    id: "v2",
    key: "DEBUG",
    value: "true",
    updatedAt: "",
    updatedBy: "",
  },
];

function renderEnvFileFields(params?: {
  currentAuthorId?: string | null;
  isEditing?: boolean | undefined;
  onAddVariable?: () => void;
  onRemoveVariable?: (id: string) => void;
  onRenameFile?: (value: string) => void;
  onUpdateVariable?: (id: string, field: string, value: string) => void;
  ready?: boolean;
  variables?: EnvVariableRow[];
}) {
  return render(
    <EnvFileFields
      currentAuthorId={params?.currentAuthorId ?? null}
      fileName=".env.local"
      fileNameInputId="env-file-name"
      isEditing={params?.isEditing}
      onAddVariable={params?.onAddVariable ?? (() => undefined)}
      onRemoveVariable={params?.onRemoveVariable ?? (() => undefined)}
      onRenameFile={params?.onRenameFile ?? (() => undefined)}
      onUpdateVariable={params?.onUpdateVariable ?? (() => undefined)}
      ready={params?.ready ?? true}
      variables={params?.variables ?? variables}
    />,
  );
}

test("renders env variables as editable key value rows", () => {
  const view = renderEnvFileFields();

  expect(
    (view.getByLabelText(".env file name") as HTMLInputElement).value,
  ).toBe(".env.local");
  expect(
    (view.getByLabelText("Env variable 1 key") as HTMLInputElement).value,
  ).toBe("API_URL");
  expect(
    (view.getByLabelText("Env variable 1 value") as HTMLInputElement).value,
  ).toBe("https://api.example.test");
  expect(view.container.querySelector(".env-file-variable-row")).toBeTruthy();
});

test("read mode renders text rows, masks passwords, and shows attribution", () => {
  const view = renderEnvFileFields({
    currentAuthorId: "user-alice",
    variables: [
      variables[0] as EnvVariableRow,
      {
        id: "v3",
        key: "DATABASE_PASSWORD",
        value: "super-secret",
        updatedAt: "2026-07-16T09:00:00.000Z",
        updatedBy: "user-bob",
      },
    ],
    isEditing: false,
  });

  expect(view.getByText(".env.local")).toBeTruthy();
  expect(view.getByText("API_URL")).toBeTruthy();
  expect(view.getByText("https://api.example.test")).toBeTruthy();
  expect(view.getByText("DATABASE_PASSWORD")).toBeTruthy();
  expect(view.getByText("********")).toBeTruthy();
  expect(view.queryByText("super-secret")).toBeNull();
  // The local writer reads as "you"; another writer shows a shortened id.
  expect(view.getByText("Updated 2026-07-16 08:30 by you")).toBeTruthy();
  expect(view.getByText("Updated 2026-07-16 09:00 by user-bob")).toBeTruthy();
  expect(view.queryByLabelText(".env file name")).toBeNull();
});

test("read mode tolerates missing variable values", () => {
  const view = renderEnvFileFields({
    variables: [
      {
        id: "v-missing",
        key: "",
        value: "",
        updatedAt: "",
        updatedBy: "",
      },
    ],
    isEditing: false,
  });

  expect(view.getAllByText("None")).toHaveLength(2);
});

test("edits file name and variable cells through callbacks", () => {
  const renameCalls: string[] = [];
  const updateCalls: Array<[string, string, string]> = [];
  const view = renderEnvFileFields({
    onRenameFile: (value) => renameCalls.push(value),
    onUpdateVariable: (id, field, value) =>
      updateCalls.push([id, field, value]),
  });

  fireEvent.change(view.getByLabelText(".env file name"), {
    target: { value: ".env.production" },
  });
  fireEvent.change(view.getByLabelText("Env variable 1 key"), {
    target: { value: "PUBLIC_API_URL" },
  });
  fireEvent.change(view.getByLabelText("Env variable 2 value"), {
    target: { value: "false" },
  });

  expect(renameCalls).toEqual([".env.production"]);
  expect(updateCalls).toEqual([
    ["v1", "key", "PUBLIC_API_URL"],
    ["v2", "value", "false"],
  ]);
});

test("marks existing malformed variable keys invalid", () => {
  const view = renderEnvFileFields({
    variables: [
      {
        id: "v-bad",
        key: "BAD KEY",
        value: "bad",
        updatedAt: "",
        updatedBy: "",
      },
    ],
  });

  expect(
    view.getByLabelText("Env variable 1 key").getAttribute("aria-invalid"),
  ).toBe("true");
  expect(
    view.getByLabelText("Env variable 1 key").getAttribute("pattern"),
  ).toBe(ENV_FILE_VARIABLE_NAME_PATTERN);
});

test("add and remove buttons invoke their callbacks", () => {
  let addCalls = 0;
  const removeCalls: string[] = [];
  const view = renderEnvFileFields({
    onAddVariable: () => {
      addCalls += 1;
    },
    onRemoveVariable: (id) => removeCalls.push(id),
  });

  fireEvent.click(view.getByRole("button", { name: "Add Variable" }));
  fireEvent.click(view.getByRole("button", { name: "Remove env variable 1" }));

  expect(addCalls).toBe(1);
  expect(removeCalls).toEqual(["v1"]);
});

test("disables controls while the document is loading", () => {
  const view = renderEnvFileFields({ ready: false });

  expect(
    (view.getByLabelText(".env file name") as HTMLInputElement).disabled,
  ).toBe(true);
  expect(
    (view.getByLabelText("Env variable 1 key") as HTMLInputElement).disabled,
  ).toBe(true);
  expect(
    (view.getByRole("button", { name: "Add Variable" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

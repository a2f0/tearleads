import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { EnvFileFields } from "./EnvFile";
import { ENV_FILE_VARIABLE_NAME_PATTERN } from "./envFileDocumentDefinition";
import type { EnvVariableRow } from "./envFileVariables";

afterEach(cleanup);

function makeVariable(
  overrides: Partial<EnvVariableRow> & { id: string },
): EnvVariableRow {
  return {
    key: "",
    value: "",
    createdAt: "",
    createdBy: "",
    createdByPeer: null,
    updatedAt: "",
    updatedBy: "",
    updatedByPeer: null,
    fieldEditors: {},
    ...overrides,
  };
}

const variables: EnvVariableRow[] = [
  makeVariable({
    id: "v1",
    key: "API_URL",
    value: "https://api.example.test",
    updatedAt: "2026-07-16T08:30:00.000Z",
    updatedBy: "user-alice",
    updatedByPeer: "7",
  }),
  makeVariable({ id: "v2", key: "DEBUG", value: "true" }),
];

function renderEnvFileFields(params?: {
  currentAuthorId?: string | null;
  isEditing?: boolean | undefined;
  onAddVariable?: () => void;
  onRemoveVariable?: (id: string) => void;
  onRenameFile?: (value: string) => void;
  onUpdateVariable?: (id: string, field: string, value: string) => void;
  ready?: boolean;
  resolveRowWriter?: (updatedByPeer: string | null) => string | null;
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
      resolveRowWriter={params?.resolveRowWriter}
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
      makeVariable({
        id: "v3",
        key: "DATABASE_PASSWORD",
        value: "super-secret",
        updatedAt: "2026-07-16T09:00:00.000Z",
        updatedBy: "user-bob",
      }),
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
    variables: [makeVariable({ id: "v-missing" })],
    isEditing: false,
  });

  expect(view.getAllByText("None")).toHaveLength(2);
});

test("read mode resolves an authoritative writer over the self-attested one", () => {
  const view = renderEnvFileFields({
    currentAuthorId: "user-alice",
    isEditing: false,
    variables: [
      makeVariable({
        id: "v1",
        key: "API_URL",
        value: "x",
        // Self-attested author claims alice, but the variable was written by
        // peer "9", which resolves to the verified writer user-bob.
        updatedAt: "2026-07-16T08:30:00.000Z",
        updatedBy: "user-alice",
        updatedByPeer: "9",
      }),
    ],
    resolveRowWriter: (peer) => (peer === "9" ? "user-bob" : null),
  });

  expect(view.getByText("Updated 2026-07-16 08:30 by user-bob")).toBeTruthy();
  expect(view.queryByText("Updated 2026-07-16 08:30 by you")).toBeNull();
});

test("read mode falls back to the self-attested author when unresolved", () => {
  const view = renderEnvFileFields({
    currentAuthorId: "user-alice",
    isEditing: false,
    // v1's updatedBy is user-alice (=== currentAuthorId) → "you".
    resolveRowWriter: () => null,
  });

  expect(view.getByText("Updated 2026-07-16 08:30 by you")).toBeTruthy();
});

test("read mode drills into a variable detail, keeping secrets masked", () => {
  const view = renderEnvFileFields({
    currentAuthorId: "user-alice",
    isEditing: false,
    variables: [
      makeVariable({
        id: "v-secret",
        key: "DATABASE_PASSWORD",
        value: "super-secret",
        createdAt: "2026-07-16T08:00:00.000Z",
        createdBy: "user-alice",
        createdByPeer: "7",
        updatedAt: "2026-07-16T09:00:00.000Z",
        updatedBy: "user-alice",
        updatedByPeer: "9",
        // The key was last written by peer 7 (→ you); the value by peer 9
        // (→ user-bob).
        fieldEditors: { key: "7", value: "9" },
      }),
    ],
    resolveRowWriter: (peer) => {
      if (peer === "9") {
        return "user-bob";
      }
      if (peer === "7") {
        return "user-alice";
      }
      return null;
    },
  });

  expect(view.queryByRole("dialog")).toBeNull();
  const kebab = view.getByRole("button", { name: "Env variable 1 details" });
  kebab.focus();
  fireEvent.click(kebab);

  expect(view.getByRole("dialog", { name: "DATABASE_PASSWORD" })).toBeTruthy();
  // The secret stays masked in the drill-down and never leaks in cleartext.
  expect(view.queryByText("super-secret")).toBeNull();
  expect(view.getByText("set by you")).toBeTruthy();
  expect(view.getByText("set by user-bob")).toBeTruthy();

  // Opening moves focus into the dialog; closing restores it to the kebab.
  const close = view.getByRole("button", { name: "Close" });
  expect(document.activeElement).toBe(close);
  fireEvent.click(close);
  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(kebab);
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
    variables: [makeVariable({ id: "v-bad", key: "BAD KEY", value: "bad" })],
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

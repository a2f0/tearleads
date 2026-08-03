import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { WithWindowToolbar } from "../../../test/helpers/windowToolbarProbe";
import { EnvFileFields } from "./EnvFile";
import type { EnvFileQuickVariable } from "./EnvFileQuickAdd";
import { ENV_FILE_VARIABLE_NAME_PATTERN } from "./envFileDocumentDefinition";
import type { EnvVariableRow } from "./envFileVariables";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "clipboard",
);

afterEach(() => {
  cleanup();
  if (originalClipboardDescriptor) {
    Object.defineProperty(
      Navigator.prototype,
      "clipboard",
      originalClipboardDescriptor,
    );
  } else {
    delete (Navigator.prototype as { clipboard?: Clipboard }).clipboard;
  }
});

function installClipboard(copied: string[]): void {
  Object.defineProperty(Navigator.prototype, "clipboard", {
    configurable: true,
    get: () => ({
      writeText: (value: string) => {
        copied.push(value);
        return Promise.resolve();
      },
    }),
  });
}

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
  editingVariableId?: string | null;
  isEditing?: boolean | undefined;
  onAddVariable?: (variable: EnvFileQuickVariable) => Promise<string | null>;
  onEnterEdit?: ((id: string) => void) | undefined;
  onRemoveVariable?: (id: string) => void;
  onRenameFile?: (value: string) => void;
  onToggleEditing?: () => void;
  onUpdateVariable?: (id: string, field: string, value: string) => void;
  ready?: boolean;
  resolveRowWriter?: (updatedByPeer: string | null) => string | null;
  variables?: EnvVariableRow[];
}) {
  return render(
    <WithWindowToolbar>
      <EnvFileFields
        currentAuthorId={params?.currentAuthorId ?? null}
        editingVariableId={params?.editingVariableId}
        fileName=".env.local"
        fileNameInputId="env-file-name"
        isEditing={params?.isEditing}
        onAddVariable={
          params?.onAddVariable ?? (() => Promise.resolve("new-variable"))
        }
        onEnterEdit={params?.onEnterEdit}
        onRemoveVariable={params?.onRemoveVariable ?? (() => undefined)}
        onRenameFile={params?.onRenameFile ?? (() => undefined)}
        onToggleEditing={params?.onToggleEditing ?? (() => undefined)}
        onUpdateVariable={params?.onUpdateVariable ?? (() => undefined)}
        ready={params?.ready ?? true}
        resolveRowWriter={params?.resolveRowWriter}
        variables={params?.variables ?? variables}
      />
    </WithWindowToolbar>,
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
  const value = view.getByLabelText("Env variable 1 value") as HTMLInputElement;
  expect(value.value).toBe("https://api.example.test");
  expect(value.type).toBe("password");
  fireEvent.click(
    view.getByRole("button", { name: "Show Env variable 1 value" }),
  );
  expect(value.type).toBe("text");
  fireEvent.click(
    view.getByRole("button", { name: "Hide Env variable 1 value" }),
  );
  expect(value.type).toBe("password");
  expect(view.container.querySelector(".env-file-variable-row")).toBeTruthy();
});

test("read mode masks every value and shows the final four characters", () => {
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

  expect(view.queryByText(".env.local")).toBeNull();
  expect(view.getByText("API_URL")).toBeTruthy();
  expect(view.getByText("********test")).toBeTruthy();
  expect(view.getByText("DATABASE_PASSWORD")).toBeTruthy();
  expect(view.getByText("********cret")).toBeTruthy();
  expect(view.queryByText("https://api.example.test")).toBeNull();
  expect(view.queryByText("super-secret")).toBeNull();
  expect(view.queryByLabelText(".env file name")).toBeNull();
});

test("read mode reveals and copies the original env value", async () => {
  const copied: string[] = [];
  installClipboard(copied);
  const view = renderEnvFileFields({ isEditing: false });

  expect(view.getByText("********test")).toBeTruthy();
  fireEvent.click(
    view.getByRole("button", { name: "Show Env variable 1 value" }),
  );
  expect(view.getByText("https://api.example.test")).toBeTruthy();
  expect(
    view.getByRole("button", { name: "Hide Env variable 1 value" }),
  ).toBeTruthy();

  const copy = view.getByRole("button", {
    name: "Copy Env variable 1 value",
  });
  fireEvent.click(copy);
  await waitFor(() => {
    expect(copy.getAttribute("title")).toBe("Copied to clipboard");
  });
  expect(copied).toEqual(["https://api.example.test"]);
});

test("variable count follows the rows", () => {
  const view = renderEnvFileFields({ isEditing: false });
  const rows = view.container.querySelectorAll(".tracker-read-table-row");
  const footer = view.container.querySelector(".tracker-entry-list-footer");
  expect(footer).not.toBeNull();
  const position =
    rows[rows.length - 1]?.compareDocumentPosition(footer as Node) ?? 0;

  expect(footer?.textContent).toBe("2 entries");
  expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("read mode tolerates missing variable values", () => {
  const view = renderEnvFileFields({
    variables: [makeVariable({ id: "v-missing" })],
    isEditing: false,
  });

  expect(view.getAllByText("None")).toHaveLength(2);
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
  expect(kebab.getAttribute("aria-expanded")).toBe("false");
  kebab.focus();
  fireEvent.click(kebab);

  expect(kebab.getAttribute("aria-expanded")).toBe("true");
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

test("read mode saves a new variable without entering edit mode", () => {
  const added: EnvFileQuickVariable[] = [];
  let toggleCalls = 0;
  const view = renderEnvFileFields({
    isEditing: false,
    onAddVariable: (variable) => {
      added.push(variable);
      return Promise.resolve("v-new");
    },
    onEnterEdit: () => undefined,
    onToggleEditing: () => {
      toggleCalls += 1;
    },
    variables: [],
  });

  fireEvent.click(view.getByRole("button", { name: "Add Variable" }));
  expect(view.queryByRole("button", { name: "Add Variable" })).toBeNull();
  expect(view.queryByText("No variables")).toBeNull();
  const toolbarEdit = view.getByRole("button", { name: "Toolbar Edit" });
  expect((toolbarEdit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(toolbarEdit);
  expect(view.getByLabelText("Quick add env variable key")).toBeTruthy();
  fireEvent.change(view.getByLabelText("Quick add env variable key"), {
    target: { value: "API_TOKEN" },
  });
  fireEvent.change(view.getByLabelText("Quick add env variable value"), {
    target: { value: "secret" },
  });
  expect(
    (view.getByLabelText("Quick add env variable value") as HTMLInputElement)
      .type,
  ).toBe("password");
  fireEvent.click(view.getByRole("button", { name: "Save Variable" }));

  expect(added).toEqual([{ key: "API_TOKEN", value: "secret" }]);
  expect(view.getByRole("button", { name: "Add Variable" })).toBeTruthy();
  expect((toolbarEdit as HTMLButtonElement).disabled).toBe(false);
  expect(view.queryByLabelText(".env file name")).toBeNull();
  expect(toggleCalls).toBe(0);
});

test("quick add rejects malformed keys and cancel clears the draft", () => {
  const view = renderEnvFileFields();

  fireEvent.click(view.getByRole("button", { name: "Add Variable" }));
  const key = view.getByLabelText("Quick add env variable key");
  fireEvent.change(key, { target: { value: "BAD KEY" } });
  expect(key.getAttribute("aria-invalid")).toBe("true");
  expect(
    (view.getByRole("button", { name: "Save Variable" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);

  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  fireEvent.click(view.getByRole("button", { name: "Add Variable" }));
  expect(
    (view.getByLabelText("Quick add env variable key") as HTMLInputElement)
      .value,
  ).toBe("");
});

test("a variable kebab targets only that variable for editing", () => {
  const editedVariableIds: string[] = [];
  const readView = renderEnvFileFields({
    isEditing: false,
    onEnterEdit: (id) => editedVariableIds.push(id),
  });

  fireEvent.click(
    readView.getByRole("button", { name: "Env variable 2 actions" }),
  );
  fireEvent.click(readView.getByRole("button", { name: "Edit" }));
  expect(editedVariableIds).toEqual(["v2"]);
  readView.unmount();

  const editView = renderEnvFileFields({ editingVariableId: "v2" });
  expect(editView.queryByLabelText("Env variable 1 key")).toBeNull();
  expect(editView.getByLabelText("Env variable 2 key")).toBeTruthy();
  expect(
    editView.getByRole("button", { name: "Env variable 1 actions" }),
  ).toBeTruthy();
  expect(
    editView.queryByRole("button", { name: "Env variable 2 actions" }),
  ).toBeNull();
});

test("a pending variable owns the read-mode entry state", () => {
  const view = renderEnvFileFields({
    isEditing: false,
    onEnterEdit: () => undefined,
  });

  fireEvent.click(view.getByRole("button", { name: "Env variable 1 actions" }));
  expect(view.getByRole("button", { name: "Edit" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Add Variable" }));
  expect(
    (view.getByRole("button", { name: "Toolbar Edit" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    view.queryByRole("button", { name: "Env variable 1 actions" }),
  ).toBeNull();
  expect(
    view.getByRole("button", { name: "Env variable 1 details" }),
  ).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(view.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(
    (view.getByRole("button", { name: "Toolbar Edit" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

test("each variable saves independently beside Remove", () => {
  const removals: string[] = [];
  const view = renderEnvFileFields({
    currentAuthorId: "user-alice",
    onRemoveVariable: (id) => removals.push(id),
    resolveRowWriter: (peer) => (peer === "9" ? "user-bob" : null),
    variables: [
      makeVariable({
        id: "v1",
        key: "API_TOKEN",
        value: "secret",
        updatedAt: "2026-07-16T09:00:00.000Z",
        updatedBy: "user-alice",
        updatedByPeer: "9",
      }),
      makeVariable({ id: "v2", key: "DEBUG", value: "true" }),
    ],
  });

  const save = view.getByRole("button", { name: "Save env variable 1" });
  const remove = view.getByRole("button", { name: "Remove env variable 1" });
  expect(save.parentElement).toBe(remove.parentElement);
  fireEvent.click(save);
  expect(view.queryByLabelText("Env variable 1 key")).toBeNull();
  expect(view.getByLabelText("Env variable 2 key")).toBeTruthy();
  expect(view.getByText(/by user-bob/u)).toBeTruthy();
  expect(view.getByRole("button", { name: "Toolbar Save" })).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: "Env variable 1 actions" }));
  fireEvent.click(view.getByRole("button", { name: "Edit" }));
  fireEvent.click(view.getByRole("button", { name: "Remove env variable 1" }));
  expect(removals).toEqual(["v1"]);
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
  expect(
    (
      view.getByRole("button", {
        name: "Save env variable 1",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

test("edit toggle lives in the toolbar, not the document body", () => {
  let toggles = 0;
  const view = renderEnvFileFields({
    isEditing: false,
    onToggleEditing: () => {
      toggles += 1;
    },
  });

  expect(view.queryByRole("button", { name: "Edit" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Toolbar Edit" }));

  expect(toggles).toBe(1);
});

test("toolbar and entry actions use Save while editing", () => {
  const view = renderEnvFileFields({ isEditing: true });

  expect(view.getByRole("button", { name: "Toolbar Save" })).toBeTruthy();
  expect(
    view.getByRole("button", { name: "Save env variable 1" }),
  ).toBeTruthy();
});

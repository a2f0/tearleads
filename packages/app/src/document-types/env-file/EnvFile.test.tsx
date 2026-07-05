import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { EnvFileFields } from "./EnvFile";
import {
  ENV_FILE_VARIABLE_NAME_PATTERN,
  type EnvFileDocumentFields,
  type EnvFileVariable,
  serializeEnvFileVariables,
} from "./envFileDocument";

afterEach(cleanup);

const variables: EnvFileVariable[] = [
  {
    id: "env-1-api-url",
    key: "API_URL",
    value: "https://api.example.test",
  },
  {
    id: "env-2-debug",
    key: "DEBUG",
    value: "true",
  },
];

function createFields(
  overrides: Partial<EnvFileDocumentFields> = {},
): EnvFileDocumentFields {
  const nextVariables = overrides.variables ?? variables;
  return {
    fileName: ".env.local",
    variables: nextVariables,
    variablesJson: serializeEnvFileVariables(nextVariables),
    ...overrides,
  };
}

function parseVariablePatch(
  patch: { variablesJson?: string } | undefined,
): EnvFileVariable[] {
  return JSON.parse(patch?.variablesJson ?? "[]") as EnvFileVariable[];
}

function renderEnvFileFields(params?: {
  fields?: EnvFileDocumentFields;
  isEditing?: boolean | undefined;
  onChange?: (patch: Record<string, string>) => void;
  ready?: boolean;
}) {
  return render(
    <EnvFileFields
      fields={params?.fields ?? createFields()}
      fileNameInputId="env-file-name"
      isEditing={params?.isEditing}
      onChange={params?.onChange ?? (() => undefined)}
      ready={params?.ready ?? true}
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

test("read mode renders text rows and masks password values", () => {
  const view = renderEnvFileFields({
    fields: createFields({
      variables: [
        variables[0] as EnvFileVariable,
        {
          id: "env-3-password",
          key: "DATABASE_PASSWORD",
          value: "super-secret",
        },
      ],
    }),
    isEditing: false,
  });

  expect(view.getByText(".env.local")).toBeTruthy();
  expect(view.getByText("API_URL")).toBeTruthy();
  expect(view.getByText("https://api.example.test")).toBeTruthy();
  expect(view.getByText("DATABASE_PASSWORD")).toBeTruthy();
  expect(view.getByText("********")).toBeTruthy();
  expect(view.queryByText("super-secret")).toBeNull();
  expect(view.queryByLabelText(".env file name")).toBeNull();
  expect(view.queryByLabelText("Env variable 2 value")).toBeNull();
});

test("read mode tolerates missing file and variable values", () => {
  const view = renderEnvFileFields({
    fields: createFields({
      fileName: undefined as unknown as string,
      variables: [
        {
          id: "env-missing",
          key: undefined as unknown as string,
          value: null as unknown as string,
        },
      ],
    }),
    isEditing: false,
  });

  expect(view.getAllByText("None")).toHaveLength(3);
  expect(view.queryByLabelText(".env file name")).toBeNull();
});

test("edits file name and variable values through structured field patches", () => {
  const patches: Array<Record<string, string>> = [];
  const view = renderEnvFileFields({
    onChange: (patch) => patches.push(patch),
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

  expect(patches[0]).toEqual({ fileName: ".env.production" });
  expect(parseVariablePatch(patches[1])).toEqual([
    {
      id: "env-1-api-url",
      key: "PUBLIC_API_URL",
      value: "https://api.example.test",
    },
    variables[1] as EnvFileVariable,
  ]);
  expect(parseVariablePatch(patches[2])).toEqual([
    variables[0] as EnvFileVariable,
    {
      id: "env-2-debug",
      key: "DEBUG",
      value: "false",
    },
  ]);
});

test("exposes POSIX key validation without blocking editable drafts", () => {
  const patches: Array<Record<string, string>> = [];
  const view = renderEnvFileFields({
    onChange: (patch) => patches.push(patch),
  });
  const keyInput = view.getByLabelText(
    "Env variable 1 key",
  ) as HTMLInputElement;

  expect(keyInput.pattern).toBe(ENV_FILE_VARIABLE_NAME_PATTERN);

  fireEvent.change(keyInput, {
    target: { value: "PUBLIC API URL" },
  });
  fireEvent.change(keyInput, {
    target: { value: "1PUBLIC_API_URL" },
  });
  fireEvent.change(keyInput, {
    target: { value: "PUBLIC_API_URL" },
  });

  expect(parseVariablePatch(patches[0])).toEqual([
    {
      id: "env-1-api-url",
      key: "PUBLIC API URL",
      value: "https://api.example.test",
    },
    variables[1] as EnvFileVariable,
  ]);
  expect(parseVariablePatch(patches[1])).toEqual([
    {
      id: "env-1-api-url",
      key: "1PUBLIC_API_URL",
      value: "https://api.example.test",
    },
    variables[1] as EnvFileVariable,
  ]);
  expect(parseVariablePatch(patches[2])).toEqual([
    {
      id: "env-1-api-url",
      key: "PUBLIC_API_URL",
      value: "https://api.example.test",
    },
    variables[1] as EnvFileVariable,
  ]);
});

test("marks existing malformed variable keys invalid", () => {
  const view = renderEnvFileFields({
    fields: createFields({
      variables: [
        {
          id: "env-1-bad",
          key: "BAD KEY",
          value: "bad",
        },
      ],
    }),
  });

  expect(
    view.getByLabelText("Env variable 1 key").getAttribute("aria-invalid"),
  ).toBe("true");
});

test("adds and removes variable rows", () => {
  const patches: Array<Record<string, string>> = [];
  const view = renderEnvFileFields({
    onChange: (patch) => patches.push(patch),
  });

  fireEvent.click(view.getByRole("button", { name: "Add Variable" }));
  fireEvent.click(view.getByRole("button", { name: "Remove env variable 1" }));

  const addedVariables = parseVariablePatch(patches[0]);
  expect(addedVariables).toHaveLength(3);
  expect(addedVariables[2]).toMatchObject({ key: "", value: "" });
  expect(parseVariablePatch(patches[1])).toEqual([
    variables[1] as EnvFileVariable,
  ]);
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

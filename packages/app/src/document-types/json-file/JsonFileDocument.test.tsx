import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { JsonFileFields } from "./JsonFileDocument";
import type { JsonFileDocumentFields } from "./jsonFileDocumentDefinition";

afterEach(cleanup);

const jsonFields: JsonFileDocumentFields = {
  fileName: "config.json",
};
const jsonText = '{\n  "enabled": true\n}';

function renderJsonFileFields(
  overrides: Partial<Parameters<typeof JsonFileFields>[0]> = {},
) {
  return render(
    <JsonFileFields
      contentInputId="json-content"
      fields={jsonFields}
      fileNameInputId="json-file-name"
      onChangeFields={() => undefined}
      onChangeText={() => undefined}
      ready
      text={jsonText}
      {...overrides}
    />,
  );
}

test("read mode shows the file name and raw JSON without editable inputs", () => {
  const view = renderJsonFileFields();

  expect(view.getByText("config.json")).toBeTruthy();
  expect(
    view.container.querySelector(".json-file-content-view")?.textContent,
  ).toBe(jsonText);
  expect(view.queryByLabelText("JSON file name")).toBeNull();
  expect(view.queryByLabelText("JSON content")).toBeNull();
});

test("edit mode renames the JSON file without changing content", () => {
  const fieldPatches: Array<Record<string, string>> = [];
  const textChanges: string[] = [];
  const view = renderJsonFileFields({
    isEditing: true,
    onChangeFields: (patch) => fieldPatches.push(patch),
    onChangeText: (value) => textChanges.push(value),
  });

  const nameInput = view.getByLabelText("JSON file name");
  fireEvent.change(nameInput, { target: { value: "renamed.json" } });

  expect(fieldPatches).toEqual([{ fileName: "renamed.json" }]);
  expect(textChanges).toEqual([]);
  expect(
    (view.getByLabelText("JSON content") as HTMLTextAreaElement).value,
  ).toBe(jsonText);
});

test("edit mode updates raw JSON content independently", () => {
  const fieldPatches: Array<Record<string, string>> = [];
  const textChanges: string[] = [];
  const view = renderJsonFileFields({
    isEditing: true,
    onChangeFields: (patch) => fieldPatches.push(patch),
    onChangeText: (value) => textChanges.push(value),
  });

  fireEvent.change(view.getByLabelText("JSON content"), {
    target: { value: '{"renamed":true}' },
  });

  expect(fieldPatches).toEqual([]);
  expect(textChanges).toEqual(['{"renamed":true}']);
});

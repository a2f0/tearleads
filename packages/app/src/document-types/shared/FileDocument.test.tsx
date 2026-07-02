import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { FileDocumentFields } from "./FileDocument";

afterEach(cleanup);

const readFields = [
  { label: "MIME Type", value: "image/png" },
  { label: "Size", value: "1.2 kB" },
  { label: "Source Modified", value: "" },
];

function renderFields(
  overrides: Partial<Parameters<typeof FileDocumentFields>[0]> = {},
) {
  return render(
    <FileDocumentFields
      canWrite
      downloadDisabled={false}
      downloadError={null}
      editDisabled={false}
      fileName="report.png"
      isEditing={false}
      onCommitFileName={() => undefined}
      onDownload={() => undefined}
      onToggleEditing={() => undefined}
      readFields={readFields}
      {...overrides}
    />,
  );
}

test("view mode renders metadata as text with no editable inputs", () => {
  const view = renderFields();

  expect(view.getByText("image/png")).toBeTruthy();
  expect(view.getByText("1.2 kB")).toBeTruthy();
  expect(view.getByText("report.png")).toBeTruthy();
  // Nothing in the field list is an input while viewing.
  expect(view.queryByLabelText("File Name")).toBeNull();
  // An empty metadata field renders a placeholder, not a blank input.
  expect(view.getByText("—")).toBeTruthy();
});

test("edit mode exposes only the file name as an editable input", () => {
  const view = renderFields({ isEditing: true });

  const nameInput = view.getByLabelText("File Name") as HTMLInputElement;
  expect(nameInput.value).toBe("report.png");
  // Metadata fields stay read-only text even while editing the name.
  expect(view.queryByLabelText("MIME Type")).toBeNull();
  expect(view.queryByLabelText("Size")).toBeNull();
  expect(view.getByText("image/png")).toBeTruthy();
});

test("committing a renamed file fires onCommitFileName on blur", () => {
  const commits: string[] = [];
  const view = renderFields({
    isEditing: true,
    onCommitFileName: (value) => commits.push(value),
  });

  const nameInput = view.getByLabelText("File Name");
  fireEvent.change(nameInput, { target: { value: "renamed.png" } });
  fireEvent.blur(nameInput);

  expect(commits).toEqual(["renamed.png"]);
});

test("download button invokes onDownload and disables when unavailable", () => {
  const downloads: number[] = [];
  const view = renderFields({ onDownload: () => downloads.push(1) });

  fireEvent.click(view.getByRole("button", { name: "Download" }));
  expect(downloads).toEqual([1]);

  cleanup();
  const disabledView = renderFields({ downloadDisabled: true });
  const disabledButton = disabledView.getByRole("button", {
    name: "Download",
  }) as HTMLButtonElement;
  expect(disabledButton.disabled).toBe(true);
});

test("surfaces a download error message", () => {
  const view = renderFields({
    downloadError:
      "This file's contents haven't downloaded to this device yet.",
  });

  expect(
    view.getByText(
      "This file's contents haven't downloaded to this device yet.",
    ),
  ).toBeTruthy();
});

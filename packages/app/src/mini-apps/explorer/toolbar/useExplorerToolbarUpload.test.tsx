import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ExplorerUploadManager } from "../hooks/useExplorerUploadManager";
import { useExplorerToolbarUpload } from "./useExplorerToolbarUpload";

afterEach(() => cleanup());

function ExplorerUploadHarness(params: {
  startImport: ExplorerUploadManager["startImport"];
}) {
  const upload = useExplorerToolbarUpload({ startImport: params.startImport });

  return (
    <>
      <button type="button" onClick={() => upload.triggerUpload("folder-1")}>
        Upload to folder 1
      </button>
      <button type="button" onClick={() => upload.triggerUpload("folder-2")}>
        Upload to folder 2
      </button>
      {upload.input}
    </>
  );
}

test("one hidden picker imports into the container captured by its trigger", () => {
  const imports: Array<{
    containerId: string;
    files: ReadonlyArray<File>;
  }> = [];
  const files = [new File(["hello"], "hello.txt", { type: "text/plain" })];
  const view = render(
    <ExplorerUploadHarness
      startImport={(containerId, selectedFiles) => {
        imports.push({ containerId, files: selectedFiles });
      }}
    />,
  );
  const inputs =
    view.container.querySelectorAll<HTMLInputElement>('input[type="file"]');
  const input = inputs[0];

  expect(inputs).toHaveLength(1);
  expect(input).toBeTruthy();
  if (!input) {
    return;
  }
  expect(input.multiple).toBe(true);
  expect(input.style.display).toBe("none");

  fireEvent.click(view.getByRole("button", { name: "Upload to folder 1" }));
  fireEvent.change(input, { target: { files } });
  fireEvent.change(input, { target: { files } });
  fireEvent.click(view.getByRole("button", { name: "Upload to folder 2" }));
  fireEvent.change(input, { target: { files } });

  expect(imports).toEqual([
    { containerId: "folder-1", files },
    { containerId: "folder-2", files },
  ]);
  expect(input.value).toBe("");
});

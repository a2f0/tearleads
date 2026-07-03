import { afterEach, expect, test } from "bun:test";
import type { DocumentAttachment } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { FileDocumentAttachments, FileDocumentFields } from "./FileDocument";
import {
  isRenderableFileDocumentImageMimeType,
  resolveFileDocumentImagePreview,
} from "./FileDocumentPreview";

afterEach(cleanup);

const readFields = [
  { label: "MIME Type", value: "image/png" },
  { label: "Size", value: "1.2 kB" },
  { label: "Source Modified", value: "" },
];
const pngAttachment: DocumentAttachment = {
  byteLength: 1024,
  mimeType: "image/png",
  name: "logo.png",
  slotId: "png-slot",
};
const svgAttachment: DocumentAttachment = {
  byteLength: 2048,
  mimeType: "image/svg+xml",
  name: "mark.svg",
  slotId: "svg-slot",
};
const jpegAttachment: DocumentAttachment = {
  byteLength: 4096,
  mimeType: "image/jpeg",
  name: "photo.jpeg",
  slotId: "jpeg-slot",
};

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
  fireEvent.change(nameInput, { target: { value: "  renamed.png  " } });
  fireEvent.blur(nameInput);

  // The committed value is trimmed.
  expect(commits).toEqual(["renamed.png"]);
});

test("pressing Enter commits the rename", () => {
  const commits: string[] = [];
  const view = renderFields({
    isEditing: true,
    onCommitFileName: (value) => commits.push(value),
  });

  const nameInput = view.getByLabelText("File Name");
  nameInput.focus();
  fireEvent.change(nameInput, { target: { value: "renamed.png" } });
  fireEvent.keyDown(nameInput, { key: "Enter" });

  expect(commits).toEqual(["renamed.png"]);
});

test("an empty rename reverts instead of committing", () => {
  const commits: string[] = [];
  const view = renderFields({
    isEditing: true,
    onCommitFileName: (value) => commits.push(value),
  });

  const nameInput = view.getByLabelText("File Name") as HTMLInputElement;
  fireEvent.change(nameInput, { target: { value: "   " } });
  fireEvent.blur(nameInput);

  expect(commits).toEqual([]);
  expect(nameInput.value).toBe("report.png");
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

test("detects the image MIME types the file document can preview", () => {
  expect(isRenderableFileDocumentImageMimeType("image/png")).toBe(true);
  expect(isRenderableFileDocumentImageMimeType("image/svg+xml")).toBe(true);
  expect(
    isRenderableFileDocumentImageMimeType("image/svg+xml; charset=utf-8"),
  ).toBe(true);
  expect(isRenderableFileDocumentImageMimeType("image/jpeg")).toBe(false);
  expect(isRenderableFileDocumentImageMimeType(null)).toBe(false);
});

test("resolves the latest local PNG or SVG attachment for preview", () => {
  const preview = resolveFileDocumentImagePreview({
    attachments: [pngAttachment, svgAttachment],
    attachmentStorageKeyBySlotId: {
      "png-slot": "local-png",
      "svg-slot": "local-svg",
    },
    imageUrlBySlotId: { "svg-slot": "blob:svg-preview" },
  });

  expect(preview).toEqual({
    attachment: svgAttachment,
    imageUrl: "blob:svg-preview",
  });
});

test("does not preview unsupported image attachment types", () => {
  const preview = resolveFileDocumentImagePreview({
    attachments: [pngAttachment, jpegAttachment],
    attachmentStorageKeyBySlotId: {
      "jpeg-slot": "local-jpeg",
      "png-slot": "local-png",
    },
    imageUrlBySlotId: { "png-slot": "blob:png-preview" },
  });

  expect(preview).toBeNull();
});

test("renders a file image preview when a preview URL is available", () => {
  const view = render(
    <FileDocumentAttachments
      attachments={[pngAttachment]}
      imagePreview={{
        attachment: pngAttachment,
        imageUrl: "blob:png-preview",
      }}
    />,
  );

  const image = view.getByRole("img", { name: "logo.png" });
  expect(image.getAttribute("src")).toBe("blob:png-preview");
  expect(view.getByText("logo.png")).toBeTruthy();
  expect(view.getByText("1.0 KB")).toBeTruthy();
});

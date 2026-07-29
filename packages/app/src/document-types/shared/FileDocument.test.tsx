import { afterEach, expect, test } from "bun:test";
import type { DocumentAttachment } from "@tearleads/client-sdk";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import {
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "../../components/window/WindowMenuContext";
import { FileDocumentFields } from "./FileDocument";
import {
  isRenderableFileDocumentMediaMimeType,
  resolveFileDocumentMediaPreview,
} from "./FileDocumentPreview";

afterEach(cleanup);

// Edit and Download register into the pane's toolbar rather than the body, so
// tests render this probe to surface the registered actions as buttons — the
// same way WindowToolBar / RoutedPaneAppBar render them in the app.
function ToolbarProbe() {
  const actions = useWindowTitleBarActions();

  return (
    <div aria-label="Toolbar" role="toolbar">
      {actions.map((action) => (
        <button
          aria-label={action.label}
          disabled={action.disabled}
          key={action.id}
          type="button"
          onClick={action.onClick}
        />
      ))}
    </div>
  );
}

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
const audioAttachment: DocumentAttachment = {
  byteLength: 8192,
  mimeType: "audio/mpeg",
  name: "voice.mp3",
  slotId: "audio-slot",
};
const videoAttachment: DocumentAttachment = {
  byteLength: 16_384,
  mimeType: "video/mp4",
  name: "clip.mp4",
  slotId: "video-slot",
};
const pdfAttachment: DocumentAttachment = {
  byteLength: 32_768,
  mimeType: "application/pdf",
  name: "paper.pdf",
  slotId: "pdf-slot",
};

function renderFields(
  overrides: Partial<Parameters<typeof FileDocumentFields>[0]> = {},
) {
  return render(
    <WindowMenuProvider>
      <ToolbarProbe />
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
      />
    </WindowMenuProvider>,
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

test("edit and download live in the toolbar, not the body", async () => {
  const view = renderFields();

  await waitFor(() => {
    expect(view.getByRole("button", { name: "Edit" })).toBeTruthy();
  });
  expect(view.getByRole("button", { name: "Download" })).toBeTruthy();
  // The actions moved to the pane toolbar; no in-body action row remains.
  expect(view.container.querySelector(".mini-app-actions")).toBeNull();
});

test("clicking the toolbar edit action toggles editing", async () => {
  const toggles: number[] = [];
  const view = renderFields({ onToggleEditing: () => toggles.push(1) });

  fireEvent.click(await view.findByRole("button", { name: "Edit" }));
  expect(toggles).toEqual([1]);
});

test("editing surfaces a Done action instead of Edit", async () => {
  const view = renderFields({ isEditing: true });

  await waitFor(() => {
    expect(view.getByRole("button", { name: "Done" })).toBeTruthy();
  });
  expect(view.queryByRole("button", { name: "Edit" })).toBeNull();
});

test("read-only (trashed) files hide the edit button but keep download", async () => {
  const view = renderFields({ hideEdit: true });

  // The edit affordance is removed entirely for a trashed document, not merely
  // disabled; downloading (a read action) stays available.
  await waitFor(() => {
    expect(view.getByRole("button", { name: "Download" })).toBeTruthy();
  });
  expect(view.queryByRole("button", { name: "Edit" })).toBeNull();
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

test("download button invokes onDownload and disables when unavailable", async () => {
  const downloads: number[] = [];
  const view = renderFields({ onDownload: () => downloads.push(1) });

  fireEvent.click(await view.findByRole("button", { name: "Download" }));
  expect(downloads).toEqual([1]);

  cleanup();
  const disabledView = renderFields({ downloadDisabled: true });
  const disabledButton = (await disabledView.findByRole("button", {
    name: "Download",
  })) as HTMLButtonElement;
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

test("detects the media MIME types the file document can preview", () => {
  expect(isRenderableFileDocumentMediaMimeType("image/png")).toBe(true);
  expect(isRenderableFileDocumentMediaMimeType("image/svg+xml")).toBe(true);
  expect(
    isRenderableFileDocumentMediaMimeType("image/svg+xml; charset=utf-8"),
  ).toBe(true);
  expect(isRenderableFileDocumentMediaMimeType("image/jpeg")).toBe(true);
  expect(isRenderableFileDocumentMediaMimeType("audio/mpeg")).toBe(true);
  expect(isRenderableFileDocumentMediaMimeType("video/mp4")).toBe(true);
  expect(isRenderableFileDocumentMediaMimeType("application/pdf")).toBe(false);
  expect(isRenderableFileDocumentMediaMimeType(null)).toBe(false);
});

test("resolves the latest local previewable media attachment", () => {
  const preview = resolveFileDocumentMediaPreview({
    attachments: [pngAttachment, audioAttachment, videoAttachment],
    attachmentStorageKeyBySlotId: {
      "audio-slot": "local-audio",
      "png-slot": "local-png",
      "video-slot": "local-video",
    },
    mediaUrlBySlotId: { "video-slot": "blob:video-preview" },
  });

  expect(preview).toEqual({
    attachment: videoAttachment,
    mediaKind: "video",
    mediaUrl: "blob:video-preview",
  });
});

test("skips unsupported local attachments when resolving a media preview", () => {
  const preview = resolveFileDocumentMediaPreview({
    attachments: [pngAttachment, pdfAttachment],
    attachmentStorageKeyBySlotId: {
      "pdf-slot": "local-pdf",
      "png-slot": "local-png",
    },
    mediaUrlBySlotId: { "png-slot": "blob:png-preview" },
  });

  expect(preview).toEqual({
    attachment: pngAttachment,
    mediaKind: "image",
    mediaUrl: "blob:png-preview",
  });
});

test("skips large local attachments when resolving a media preview", () => {
  const preview = resolveFileDocumentMediaPreview({
    attachments: [{ ...videoAttachment, byteLength: 5 * 1024 * 1024 + 1 }],
    attachmentStorageKeyBySlotId: { "video-slot": "local-video" },
    mediaUrlBySlotId: { "video-slot": "blob:video-preview" },
  });

  expect(preview).toBeNull();
});

test("renders the media preview above the metadata when a URL is available", () => {
  const view = renderFields({
    mediaPreview: {
      attachment: pngAttachment,
      mediaKind: "image",
      mediaUrl: "blob:png-preview",
    },
  });

  const image = view.getByRole("img", { name: "logo.png" });
  expect(image.getAttribute("src")).toBe("blob:png-preview");

  // The preview must render before the metadata: a media viewer leads with the
  // media, not the MIME type / size rows.
  const previewPanel = view.getByLabelText("File preview");
  const mimeType = view.getByText("image/png");
  expect(
    previewPanel.compareDocumentPosition(mimeType) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("clicking an image preview opens the shared image viewer", () => {
  let downloads = 0;
  const view = renderFields({
    mediaPreview: {
      attachment: pngAttachment,
      mediaKind: "image",
      mediaUrl: "blob:png-preview",
    },
    onDownload: () => (downloads += 1),
  });

  fireEvent.click(view.getByRole("button", { name: "Open full screen" }));

  const viewer = view.getByRole("dialog");
  expect(
    viewer.querySelector<HTMLImageElement>('img[alt="logo.png"]')?.src,
  ).toContain("blob:png-preview");
  fireEvent.click(within(viewer).getByRole("button", { name: "Download" }));
  expect(downloads).toBe(1);
  fireEvent.click(view.getByRole("button", { name: "Close" }));
  expect(view.queryByRole("dialog")).toBeNull();
});

test("renders shared playback controls for audio and video previews", () => {
  const audioView = renderFields({
    mediaPreview: {
      attachment: audioAttachment,
      mediaKind: "audio",
      mediaUrl: "blob:audio-preview",
    },
  });

  const audio = audioView.getByLabelText("voice.mp3") as HTMLAudioElement;
  expect(audio.tagName).toBe("AUDIO");
  expect(audio.controls).toBe(true);
  expect(audio.getAttribute("src")).toBe("blob:audio-preview");

  cleanup();
  const videoView = renderFields({
    mediaPreview: {
      attachment: videoAttachment,
      mediaKind: "video",
      mediaUrl: "blob:video-preview",
    },
  });

  const video = videoView.getByLabelText("clip.mp4") as HTMLVideoElement;
  expect(video.tagName).toBe("VIDEO");
  expect(video.controls).toBe(true);
  expect(video.getAttribute("src")).toBe("blob:video-preview");
});

test("omits the media preview for non-media files", () => {
  const view = renderFields();

  expect(view.queryByLabelText("File preview")).toBeNull();
});

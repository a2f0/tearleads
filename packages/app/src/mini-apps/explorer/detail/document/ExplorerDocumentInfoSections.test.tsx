import { afterEach, expect, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { createElement } from "react";
import {
  getFoldedSecondaryTexts,
  mockPhoneRoutedLayout,
} from "../../../../../test/helpers/compactTableFold";
import { readKeyValueRows } from "../../../../../test/helpers/keyValueRows";
import { formatByteLength } from "../../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerDocumentInfoAttachmentsSection } from "./ExplorerDocumentInfoAttachmentsSection";
import { ExplorerDocumentInfoGeneralSection } from "./ExplorerDocumentInfoGeneralSections";
import {
  createDocumentInfo,
  createRemoteInfo,
} from "./ExplorerDocumentInfoSections.testFixtures";

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
    Reflect.deleteProperty(Navigator.prototype, "clipboard");
  }
});

test("document info attachment rows merge matching local and remote bindings", () => {
  const documentInfo = createDocumentInfo({
    attachments: [
      {
        attachmentKind: "local",
        blobId: "blob-1",
        byteLength: 12,
        createdAt: null,
        localId: "local-document-1",
        mimeType: "image/png",
        name: null,
        slotId: "slot-1",
        storageKey: "storage-1",
        updatedAt: "2026-06-20T10:00:00.000Z",
      },
      {
        attachmentKind: "local",
        blobId: "blob-2",
        byteLength: 24,
        createdAt: null,
        localId: "local-document-1",
        mimeType: "image/jpeg",
        name: null,
        slotId: "slot-2",
        storageKey: "storage-2",
        updatedAt: "2026-06-20T10:01:00.000Z",
      },
    ],
    remoteInfo: createRemoteInfo([
      {
        bindingId: "binding-1",
        blobId: "blob-1",
        slotId: "slot-1",
      },
      {
        bindingId: "binding-2",
        blobId: "blob-2",
        slotId: "slot-2",
      },
    ]),
  });

  const view = render(
    createElement(ExplorerDocumentInfoAttachmentsSection, {
      documentInfo,
      openBlobBrowserRoute: () => undefined,
    }),
  );

  expect(view.container.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(view.getAllByText("local + remote")).toHaveLength(2);
  expect(view.queryByText(/^remote$/)).toBeNull();
});

test("document info attachment rows keep unmatched remote bindings visible", () => {
  const documentInfo = createDocumentInfo({
    attachments: [
      {
        attachmentKind: "local",
        blobId: "blob-local",
        byteLength: 12,
        createdAt: null,
        localId: "local-document-1",
        mimeType: "image/png",
        name: null,
        slotId: "slot-1",
        storageKey: "storage-1",
        updatedAt: "2026-06-20T10:00:00.000Z",
      },
    ],
    remoteInfo: createRemoteInfo([
      {
        bindingId: "binding-remote",
        blobId: "blob-remote",
        slotId: "slot-1",
      },
    ]),
  });

  const view = render(
    createElement(ExplorerDocumentInfoAttachmentsSection, {
      documentInfo,
      openBlobBrowserRoute: () => undefined,
    }),
  );

  expect(view.container.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(view.getByText(/^local$/)).toBeTruthy();
  expect(view.getByText(/^remote$/)).toBeTruthy();
});

test("document info attachment rows match duplicate bindings one-to-one", () => {
  const documentInfo = createDocumentInfo({
    attachments: [
      {
        attachmentKind: "local",
        blobId: "blob-1",
        byteLength: 12,
        createdAt: null,
        localId: "local-document-1",
        mimeType: "image/png",
        name: null,
        slotId: "slot-1",
        storageKey: "storage-1",
        updatedAt: "2026-06-20T10:00:00.000Z",
      },
      {
        attachmentKind: "local",
        blobId: "blob-1",
        byteLength: 24,
        createdAt: null,
        localId: "local-document-1",
        mimeType: "image/png",
        name: null,
        slotId: "slot-1",
        storageKey: "storage-2",
        updatedAt: "2026-06-20T10:01:00.000Z",
      },
    ],
    remoteInfo: createRemoteInfo([
      {
        bindingId: "binding-1",
        blobId: "blob-1",
        slotId: "slot-1",
      },
      {
        bindingId: "binding-2",
        blobId: "blob-1",
        slotId: "slot-1",
      },
      {
        bindingId: "binding-3",
        blobId: "blob-1",
        slotId: "slot-1",
      },
    ]),
  });

  const view = render(
    createElement(ExplorerDocumentInfoAttachmentsSection, {
      documentInfo,
      openBlobBrowserRoute: () => undefined,
    }),
  );

  expect(view.container.querySelectorAll("tbody tr")).toHaveLength(3);
  expect(view.getAllByText("local + remote")).toHaveLength(2);
  expect(view.getByText(/^remote$/)).toBeTruthy();
});

test("folded attachment rows keep state, size, and time, and open the slot, blob, and blob browser", () => {
  const restoreLayout = mockPhoneRoutedLayout();
  const opened: Array<{ blobId?: string | null | undefined }> = [];
  const updatedAt = "2026-06-20T10:00:00.000Z";
  try {
    const view = render(
      createElement(ExplorerDocumentInfoAttachmentsSection, {
        documentInfo: createDocumentInfo({
          attachments: [
            {
              attachmentKind: "local",
              blobId: "blob-local",
              byteLength: 12,
              createdAt: null,
              localId: "local-document-1",
              mimeType: "image/png",
              name: "photo.png",
              slotId: "slot-1",
              storageKey: "storage-1",
              updatedAt,
            },
          ],
          remoteInfo: null,
        }),
        openBlobBrowserRoute: (input) => {
          opened.push({ blobId: input?.blobId });
        },
      }),
    );
    const table = view.getByRole("table", {
      name: EXPLORER_LABELS.documentInfoAttachmentsHeading,
    });

    expect(table.querySelectorAll("thead th")).toHaveLength(1);
    const details = [
      "local",
      formatByteLength(12),
      formatMiniAppDateTime(updatedAt),
    ].join(" · ");
    expect(getFoldedSecondaryTexts(table)).toEqual([
      [
        `${EXPLORER_LABELS.documentInfoAttachmentKindColumn} · ${EXPLORER_LABELS.documentInfoAttachmentSizeColumn} · ${EXPLORER_LABELS.documentInfoAttachmentTimeColumn}: ${details}`,
      ],
    ]);

    // The folded row has no room for the slot and blob ids, so two
    // attachments that differ only by slot would read the same.
    expect(table.textContent).not.toContain("slot-1");
    fireEvent.click(within(table).getByRole("button", { name: "photo.png" }));
    expect(opened).toEqual([]);

    const dialog = view.getByRole("dialog", {
      name: EXPLORER_LABELS.infoRowDetailAttachmentTitle,
    });
    expect(readKeyValueRows(dialog)).toEqual({
      [EXPLORER_LABELS.documentInfoAttachmentNameColumn]: "photo.png",
      [EXPLORER_LABELS.documentInfoAttachmentKindColumn]: "local",
      [EXPLORER_LABELS.documentInfoAttachmentSlotColumn]: "slot-1",
      [EXPLORER_LABELS.documentInfoAttachmentBlobColumn]: "blob-local",
      [EXPLORER_LABELS.infoRowDetailStorageKeyRow]: "storage-1",
      [EXPLORER_LABELS.infoRowDetailBindingRow]: "-",
      [EXPLORER_LABELS.documentInfoAttachmentSizeColumn]: formatByteLength(12),
      [EXPLORER_LABELS.documentInfoAttachmentTimeColumn]: `${formatMiniAppDateTime(updatedAt)} (${updatedAt})`,
    });

    // Folded there is no Blob column: the detail leads to the blob browser.
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: EXPLORER_LABELS.infoRowDetailOpenBlobAction,
      }),
    );
    expect(opened).toEqual([{ blobId: "blob-local" }]);
    expect(view.queryByRole("dialog")).toBeNull();
  } finally {
    restoreLayout();
  }
});

// A shortened id keeps its full form only for the copy: a touch screen never
// shows the tooltip, so tapping the value is the one way to reach it.
test("document info copies the full id behind a shortened value", async () => {
  const copied: string[] = [];
  Object.defineProperty(Navigator.prototype, "clipboard", {
    configurable: true,
    get: () => ({
      writeText: (value: string) => {
        copied.push(value);
        return Promise.resolve();
      },
    }),
  });
  const localId = "1f8b3134-e5a6-4b4f-9c3d-2a6155a6aa01";
  const view = render(
    createElement(ExplorerDocumentInfoGeneralSection, {
      containerName: "Container",
      documentInfo: createDocumentInfo({
        attachments: [],
        remoteInfo: createRemoteInfo([]),
      }),
      localId,
    }),
  );

  const value = view.getByRole("button", { name: "Copy Local ID" });
  expect(value.textContent).toBe("1f8b3134-e...a6aa01");
  fireEvent.click(value);

  expect(copied).toEqual([localId]);
  await waitFor(() => {
    expect(value.getAttribute("title")).toBe("Copied to clipboard");
  });
});

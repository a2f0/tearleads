import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { ExplorerDocumentInfoAttachmentsSection } from "./ExplorerDocumentInfoAttachmentsSection";
import { ExplorerDocumentInfoGeneralSection } from "./ExplorerDocumentInfoGeneralSections";
import {
  createDocumentInfo,
  createRemoteInfo,
} from "./ExplorerDocumentInfoSections.testFixtures";
import { ExplorerDocumentInfoLocalSecuritySection } from "./ExplorerDocumentInfoSecuritySections";

afterEach(() => cleanup());

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

// The panel's key/value tables share one fixed key column so that two of them
// stacked in a tab (General Details above Contributors, Local above Remote
// Security) line their values up instead of each indenting to its own longest
// key — see `--aligned` in MiniAppTable.css. It is an opt-in modifier precisely
// because the multi-column tables in the same panel must keep the auto layout: a
// two-column geometry would crush the Attachments list's four columns into two.
// That boundary is the thing worth pinning, since applying the modifier panel-
// wide is the obvious-looking simplification that silently breaks those lists.
test("document info key/value tables share the aligned key column", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([]),
  });

  for (const section of [
    ExplorerDocumentInfoGeneralSection,
    ExplorerDocumentInfoLocalSecuritySection,
  ]) {
    const view = render(
      createElement(section, {
        containerName: "Container",
        documentInfo,
        localId: "local-document-1",
      }),
    );
    const table = view.container.querySelector("table");
    expect(table?.classList.contains("mini-app-info-table--aligned")).toBe(
      true,
    );
    expect(table?.classList.contains("mini-app-info-table--borderless")).toBe(
      true,
    );
    cleanup();
  }
});

test("document info attachment list keeps its multi-column layout", () => {
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
    ],
    remoteInfo: createRemoteInfo([]),
  });

  const view = render(
    createElement(ExplorerDocumentInfoAttachmentsSection, {
      documentInfo,
      openBlobBrowserRoute: () => undefined,
    }),
  );

  const table = view.container.querySelector("table");
  expect(table?.classList.contains("mini-app-info-table--aligned")).toBe(false);
  expect(table?.querySelectorAll("thead th").length).toBeGreaterThan(2);
});

import { afterEach, expect, test } from "bun:test";
import type { DocumentInfo } from "@symcrypt/client-sdk";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { ExplorerDocumentInfoAttachmentsSection } from "./ExplorerDocumentInfoAttachmentsSection";
import {
  ExplorerDocumentInfoBlameSection,
  ExplorerDocumentInfoCharacterBlameSection,
  ExplorerDocumentInfoFieldBlameSection,
  ExplorerDocumentInfoGeneralSection,
} from "./ExplorerDocumentInfoGeneralSections";
import { ExplorerDocumentInfoLocalSecuritySection } from "./ExplorerDocumentInfoSecuritySections";

type DocumentInfoAttributionSegment = NonNullable<
  DocumentInfo["remoteInfo"]
>["attributionSegments"][number];

type DocumentInfoCharacterBlame = NonNullable<
  DocumentInfo["remoteInfo"]
>["characterBlame"];

type DocumentInfoBlameRanges = NonNullable<
  DocumentInfo["remoteInfo"]
>["blameRanges"];

type DocumentInfoFieldBlame = NonNullable<
  DocumentInfo["remoteInfo"]
>["fieldBlame"];

afterEach(() => cleanup());

function createRemoteInfo(
  activeAttachmentBindings: NonNullable<
    DocumentInfo["remoteInfo"]
  >["activeAttachmentBindings"],
  attributionSegments: ReadonlyArray<DocumentInfoAttributionSegment> = [],
  characterBlame: DocumentInfoCharacterBlame = {
    writers: [],
    totalCharacterCount: 0,
    unattributedCharacterCount: 0,
  },
  blameRanges: DocumentInfoBlameRanges = [],
  fieldBlame: DocumentInfoFieldBlame = [],
): NonNullable<DocumentInfo["remoteInfo"]> {
  return {
    activeAttachmentBindings,
    attributionRevision: 7,
    attributionSegments: [...attributionSegments],
    attributionStatus: "available",
    authorizingContainerPaths: [],
    blameRanges,
    characterBlame,
    fieldBlame,
    contentKeyEpoch: 1,
    contentKeyTargetCount: 1,
    contentKeyTargetHash: "content-key-target-hash",
    contributors: [],
    currentManifestHash: "document-manifest-hash",
    documentContainerManifestHistoryCount: 0,
    documentKekTargetCount: 1,
    documentKeyTargetHash: "document-key-target-hash",
    documentManifestContainerPathCount: 0,
    documentManifestHistoryCount: 0,
    linkedContainerKeyEpochCount: 0,
    linkedContainerManifestCount: 0,
    linkSetManifestHash: "link-set-manifest-hash",
    manifestEpoch: 1,
    previousManifestHash: null,
    referencedPrincipalCount: 1,
  };
}

function createDocumentInfo(input: {
  attachments: DocumentInfo["attachments"];
  remoteInfo: DocumentInfo["remoteInfo"];
}): DocumentInfo {
  return {
    attachments: input.attachments,
    local: {
      accessEpoch: 1,
      accessStateHash: "access-state-hash",
      containerId: "container-1",
      documentId: "document-1",
      documentKind: "note",
      hasContentKeyBundle: true,
      hasDocumentKekTargets: true,
      hasDocumentManifestBundle: true,
      lastCommitLsn: "commit-1",
      localDocumentManifestHash: "local-document-manifest-hash",
      localId: "local-document-1",
      pendingAttachmentByteLength: 0,
      pendingAttachmentCount: 0,
      pendingUpdateCount: 0,
      title: "Note",
      updatedAt: "2026-06-20T10:00:00.000Z",
    },
    remoteInfo: input.remoteInfo,
  };
}

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

test("character blame section lists live-character counts per writer", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], {
      writers: [
        {
          writerUserId: "writer-1",
          writerKeyFingerprint: "fingerprint-1",
          characterCount: 8,
          directCharacterCount: 8,
          baselineCharacterCount: 0,
          hasDirectAuthority: true,
          hasBaselineAuthority: false,
        },
        {
          writerUserId: "writer-2",
          writerKeyFingerprint: "fingerprint-2",
          characterCount: 3,
          directCharacterCount: 0,
          baselineCharacterCount: 3,
          hasDirectAuthority: false,
          hasBaselineAuthority: true,
        },
      ],
      totalCharacterCount: 13,
      unattributedCharacterCount: 2,
    }),
  });

  const view = render(
    createElement(ExplorerDocumentInfoCharacterBlameSection, { documentInfo }),
  );

  expect(view.getByText("8 characters")).toBeTruthy();
  // A baseline-only writer is flagged re-asserted.
  expect(view.getByText("3 characters (re-asserted)")).toBeTruthy();
  // Characters no segment covers get their own row.
  expect(view.getByText("Unattributed")).toBeTruthy();
  expect(view.getByText("2 characters")).toBeTruthy();
});

test("character blame section is hidden when blame is unavailable", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], null),
  });

  const view = render(
    createElement(ExplorerDocumentInfoCharacterBlameSection, { documentInfo }),
  );

  expect(view.container.querySelector("table")).toBeNull();
});

test("character blame section is hidden for an empty document", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], {
      writers: [],
      totalCharacterCount: 0,
      unattributedCharacterCount: 0,
    }),
  });

  const view = render(
    createElement(ExplorerDocumentInfoCharacterBlameSection, { documentInfo }),
  );

  expect(view.container.querySelector("table")).toBeNull();
});

test("character blame section shows unattributed-only text", () => {
  // The document has characters but the attribution feed covers none of them yet
  // — surface the unattributed count rather than hiding the section.
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], {
      writers: [],
      totalCharacterCount: 4,
      unattributedCharacterCount: 4,
    }),
  });

  const view = render(
    createElement(ExplorerDocumentInfoCharacterBlameSection, { documentInfo }),
  );

  expect(view.getByText("Unattributed")).toBeTruthy();
  expect(view.getByText("4 characters")).toBeTruthy();
});

test("blame section renders prose runs tinted per writer with a legend", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], undefined, [
      {
        startIndex: 0,
        endIndex: 2,
        text: "Hi",
        writerUserId: "alice",
        writerKeyFingerprint: "fp-alice",
        authorityKind: "direct",
      },
      {
        startIndex: 2,
        endIndex: 8,
        text: " there",
        writerUserId: "bob",
        writerKeyFingerprint: "fp-bob",
        authorityKind: "direct",
      },
    ]),
  });

  const view = render(
    createElement(ExplorerDocumentInfoBlameSection, { documentInfo }),
  );

  expect(view.container.querySelector(".explorer-blame-prose")).toBeTruthy();
  expect(view.getByText("Hi")).toBeTruthy();
  expect(view.getByText("there")).toBeTruthy();
  // The writer's signing identity is carried on each run's tooltip; the legend
  // repeats it, so the identity appears more than once.
  expect(view.getAllByTitle("alice · fp-alice").length).toBeGreaterThan(0);
  expect(view.getAllByTitle("bob · fp-bob").length).toBeGreaterThan(0);
});

test("blame section flags a re-asserted run on its tooltip", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], undefined, [
      {
        startIndex: 0,
        endIndex: 4,
        text: "base",
        writerUserId: "alice",
        writerKeyFingerprint: "fp-alice",
        authorityKind: "baseline",
      },
    ]),
  });

  const view = render(
    createElement(ExplorerDocumentInfoBlameSection, { documentInfo }),
  );

  expect(view.getByText("base").getAttribute("title")).toBe(
    "alice · fp-alice (re-asserted)",
  );
});

test("blame section renders an unattributed run with its legend entry", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], undefined, [
      {
        startIndex: 0,
        endIndex: 5,
        text: "draft",
        writerUserId: null,
        writerKeyFingerprint: null,
        authorityKind: null,
      },
    ]),
  });

  const view = render(
    createElement(ExplorerDocumentInfoBlameSection, { documentInfo }),
  );

  expect(view.getByText("draft")).toBeTruthy();
  expect(view.getByText("Unattributed")).toBeTruthy();
});

test("blame section is hidden when ranges are unavailable", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], undefined, null),
  });

  const view = render(
    createElement(ExplorerDocumentInfoBlameSection, { documentInfo }),
  );

  expect(view.container.querySelector(".explorer-blame-prose")).toBeNull();
});

test("blame section is hidden for an empty document", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], undefined, []),
  });

  const view = render(
    createElement(ExplorerDocumentInfoBlameSection, { documentInfo }),
  );

  expect(view.container.querySelector(".explorer-blame-prose")).toBeNull();
});

test("field blame section renders each field's writer with an unattributed row", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo(
      [],
      [],
      undefined,
      [],
      [
        {
          fieldKey: "firstName",
          writerUserId: "alice",
          writerKeyFingerprint: "fp-alice",
        },
        {
          fieldKey: "lastName",
          writerUserId: null,
          writerKeyFingerprint: null,
        },
      ],
    ),
  });

  const view = render(
    createElement(ExplorerDocumentInfoFieldBlameSection, { documentInfo }),
  );

  // Field keys are humanized for display; the writer identity is on the value
  // cell's tooltip, and an unresolved field shows the Unattributed label.
  expect(view.getByText("First Name")).toBeTruthy();
  expect(view.getByText("Last Name")).toBeTruthy();
  expect(view.getByTitle("alice · fp-alice")).toBeTruthy();
  expect(view.getByText("Unattributed")).toBeTruthy();
});

test("field blame section is hidden when field blame is unavailable", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], undefined, [], null),
  });

  const view = render(
    createElement(ExplorerDocumentInfoFieldBlameSection, { documentInfo }),
  );

  expect(view.container.querySelector("table")).toBeNull();
});

test("field blame section is hidden for a document with no fields", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], undefined, [], []),
  });

  const view = render(
    createElement(ExplorerDocumentInfoFieldBlameSection, { documentInfo }),
  );

  expect(view.container.querySelector("table")).toBeNull();
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

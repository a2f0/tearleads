import { afterEach, expect, test } from "bun:test";
import type { DocumentInfo } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { ExplorerDocumentInfoAttachmentsSection } from "./ExplorerDocumentInfoAttachmentsSection";
import {
  ExplorerDocumentInfoCharacterBlameSection,
  ExplorerDocumentInfoEditRangesSection,
} from "./ExplorerDocumentInfoGeneralSections";

type DocumentInfoAttributionSegment = NonNullable<
  DocumentInfo["remoteInfo"]
>["attributionSegments"][number];

type DocumentInfoCharacterBlame = NonNullable<
  DocumentInfo["remoteInfo"]
>["characterBlame"];

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
): NonNullable<DocumentInfo["remoteInfo"]> {
  return {
    activeAttachmentBindings,
    attributionSegments: [...attributionSegments],
    authorizingContainerPaths: [],
    characterBlame,
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

test("edit ranges section lists each attributed range with its authority", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo(
      [],
      [
        {
          peerId: "peer-1",
          startCounter: 0,
          endCounter: 5,
          opCount: 5,
          updateId: "update-aaaa",
          updateSequence: 4,
          writerUserId: "writer-1",
          writerKeyFingerprint: "fingerprint-1",
          authorityKind: "direct",
        },
        {
          peerId: "peer-2",
          startCounter: 0,
          endCounter: 3,
          opCount: 3,
          updateId: "update-bbbb",
          updateSequence: 9,
          writerUserId: "writer-2",
          writerKeyFingerprint: "fingerprint-2",
          authorityKind: "baseline",
        },
      ],
    ),
  });

  const view = render(
    createElement(ExplorerDocumentInfoEditRangesSection, { documentInfo }),
  );

  expect(view.container.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(view.getByText("0–5")).toBeTruthy();
  expect(view.getByText("Direct")).toBeTruthy();
  expect(view.getByText("Re-asserted")).toBeTruthy();
  // Each range names the signed upload that delivered it: a "#sequence" label
  // with the full update id on hover.
  const upload = view.getByText("#4");
  expect(upload).toBeTruthy();
  expect(upload.getAttribute("title")).toBe("update-aaaa");
  expect(view.getByText("#9")).toBeTruthy();
});

test("edit ranges section keeps one row per upload for the same writer/peer", () => {
  // The point of the per-upload drill-down: contiguous ranges by the same writer
  // on the same peer are no longer coalesced, so each signed upload gets its own
  // row even when nothing else distinguishes them.
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo(
      [],
      [
        {
          peerId: "peer-1",
          startCounter: 0,
          endCounter: 2,
          opCount: 2,
          updateId: "update-first",
          updateSequence: 1,
          writerUserId: "writer-1",
          writerKeyFingerprint: "fingerprint-1",
          authorityKind: "direct",
        },
        {
          peerId: "peer-1",
          startCounter: 2,
          endCounter: 4,
          opCount: 2,
          updateId: "update-second",
          updateSequence: 2,
          writerUserId: "writer-1",
          writerKeyFingerprint: "fingerprint-1",
          authorityKind: "direct",
        },
      ],
    ),
  });

  const view = render(
    createElement(ExplorerDocumentInfoEditRangesSection, { documentInfo }),
  );

  expect(view.container.querySelectorAll("tbody tr")).toHaveLength(2);
  const first = view.getByText("#1");
  const second = view.getByText("#2");
  expect(first.getAttribute("title")).toBe("update-first");
  expect(second.getAttribute("title")).toBe("update-second");
});

test("edit ranges section is hidden when there are no attributed ranges", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([]),
  });

  const view = render(
    createElement(ExplorerDocumentInfoEditRangesSection, { documentInfo }),
  );

  expect(view.container.querySelector("table")).toBeNull();
});

test("edit ranges section is hidden for local-only documents", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: null,
  });

  const view = render(
    createElement(ExplorerDocumentInfoEditRangesSection, { documentInfo }),
  );

  expect(view.container.querySelector("table")).toBeNull();
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
          hasDirectAuthority: true,
          hasBaselineAuthority: false,
        },
        {
          writerUserId: "writer-2",
          writerKeyFingerprint: "fingerprint-2",
          characterCount: 3,
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

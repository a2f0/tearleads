import { afterEach, expect, test } from "bun:test";
import type {
  DocumentAttributionRangesInput,
  DocumentAttributionRangesPage,
  DocumentInfo,
} from "@symcrypt/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { ExplorerDocumentInfoEditRangesSection } from "./ExplorerDocumentInfoEditRangesSection";

afterEach(() => cleanup());

const compactAttributionSegment = {
  authorityKind: "direct",
  endCounter: 1,
  peerId: "peer-1",
  startCounter: 0,
  writerKeyFingerprint: "fingerprint-1",
  writerUserId: "writer-1",
} as const;

function createDocumentInfo(input?: {
  attributionRevision?: number | undefined;
  currentManifestHash?: string | undefined;
  includeAttribution?: boolean | undefined;
  localOnly?: boolean | undefined;
}): DocumentInfo {
  const local = {
    accessEpoch: 1,
    accessStateHash: "access-state-hash",
    containerId: "container-1",
    documentId: "document-1",
    documentKind: "note" as const,
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
  };
  if (input?.localOnly) {
    return { attachments: [], local, remoteInfo: null };
  }
  return {
    attachments: [],
    local,
    remoteInfo: {
      activeAttachmentBindings: [],
      attributionRevision: input?.attributionRevision ?? 7,
      attributionSegments:
        input?.includeAttribution === false ? [] : [compactAttributionSegment],
      attributionStatus: "available",
      authorizingContainerPaths: [],
      blameRanges: [],
      characterBlame: {
        writers: [],
        totalCharacterCount: 0,
        unattributedCharacterCount: 0,
      },
      fieldBlame: [],
      contentKeyEpoch: 1,
      contentKeyTargetCount: 1,
      contentKeyTargetHash: "content-key-target-hash",
      contributors: [],
      currentManifestHash:
        input?.currentManifestHash ?? "document-manifest-hash",
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
    },
  };
}

test("loads only after expansion and lists detailed uploads", async () => {
  const requests: unknown[] = [];
  const loadDocumentAttributionRanges = async (
    input: unknown,
  ): Promise<DocumentAttributionRangesPage> => {
    requests.push(input);
    return {
      attributionRevision: 7,
      documentId: "document-1",
      hasMore: false,
      items: [
        {
          ...compactAttributionSegment,
          endCounter: 5,
          updateId: "update-aaaa",
        },
        {
          authorityKind: "baseline",
          endCounter: 3,
          peerId: "peer-2",
          startCounter: 0,
          updateId: "update-bbbb",
          writerKeyFingerprint: "fingerprint-2",
          writerUserId: "writer-2",
        },
      ],
      nextCursor: null,
    };
  };
  const view = render(
    createElement(ExplorerDocumentInfoEditRangesSection, {
      attributionUserLabelResolver: (userId) =>
        userId === "writer-1" ? "Countess" : null,
      documentInfo: createDocumentInfo(),
      loadDocumentAttributionRanges,
    }),
  );

  expect(requests).toHaveLength(0);
  expect(view.container.querySelector("table")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Show edit ranges" }));

  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests).toEqual([
    {
      cursor: null,
      documentId: "document-1",
      expectedRevision: 7,
      limit: 100,
    },
  ]);
  await waitFor(() =>
    expect(view.container.querySelectorAll("tbody tr")).toHaveLength(2),
  );
  expect(view.getByText("0–5")).toBeTruthy();
  expect(view.getByText("5")).toBeTruthy();
  expect(view.getByText("Direct")).toBeTruthy();
  expect(view.getByText("Re-asserted")).toBeTruthy();
  expect(view.getByText("Countess")).toBeTruthy();
  expect(view.getByText("update-aaaa").getAttribute("title")).toBe(
    "update-aaaa",
  );
  expect(view.getByText("update-bbbb")).toBeTruthy();
});

test("appends a revision-bound next page", async () => {
  const cursors: Array<string | null | undefined> = [];
  const loadDocumentAttributionRanges = async (input: {
    cursor?: string | null | undefined;
  }): Promise<DocumentAttributionRangesPage> => {
    cursors.push(input.cursor);
    const isSecondPage = input.cursor === "next-page";
    return {
      attributionRevision: 7,
      documentId: "document-1",
      hasMore: !isSecondPage,
      items: [
        {
          ...compactAttributionSegment,
          endCounter: isSecondPage ? 4 : 2,
          startCounter: isSecondPage ? 2 : 0,
          updateId: isSecondPage ? "update-second" : "update-first",
        },
      ],
      nextCursor: isSecondPage ? null : "next-page",
    };
  };
  const view = render(
    createElement(ExplorerDocumentInfoEditRangesSection, {
      documentInfo: createDocumentInfo(),
      loadDocumentAttributionRanges,
    }),
  );

  fireEvent.click(view.getByRole("button", { name: "Show edit ranges" }));
  await view.findByText("update-first");
  expect(cursors).toEqual([null]);

  fireEvent.click(view.getByRole("button", { name: "Load more" }));
  await view.findByText("update-second");
  expect(cursors).toEqual([null, "next-page"]);
  expect(view.container.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(view.queryByRole("button", { name: "Load more" })).toBeNull();
});

test("shows an error and retries the failed page", async () => {
  let attempt = 0;
  const loadDocumentAttributionRanges =
    async (): Promise<DocumentAttributionRangesPage> => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("Range service unavailable");
      }
      return {
        attributionRevision: 7,
        documentId: "document-1",
        hasMore: false,
        items: [
          {
            ...compactAttributionSegment,
            updateId: "update-retried",
          },
        ],
        nextCursor: null,
      };
    };
  const view = render(
    createElement(ExplorerDocumentInfoEditRangesSection, {
      documentInfo: createDocumentInfo(),
      loadDocumentAttributionRanges,
    }),
  );

  fireEvent.click(view.getByRole("button", { name: "Show edit ranges" }));
  expect(await view.findByText("Range service unavailable")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Retry" }));

  expect(await view.findByText("update-retried")).toBeTruthy();
  expect(attempt).toBe(2);
});

test("closes and clears when the compact revision changes", async () => {
  let requestCount = 0;
  const loadDocumentAttributionRanges =
    async (): Promise<DocumentAttributionRangesPage> => {
      requestCount += 1;
      return {
        attributionRevision: 7,
        documentId: "document-1",
        hasMore: false,
        items: [
          {
            ...compactAttributionSegment,
            updateId: "update-1",
          },
        ],
        nextCursor: null,
      };
    };
  const view = render(
    createElement(ExplorerDocumentInfoEditRangesSection, {
      documentInfo: createDocumentInfo(),
      loadDocumentAttributionRanges,
    }),
  );

  fireEvent.click(view.getByRole("button", { name: "Show edit ranges" }));
  expect(await view.findByText("update-1")).toBeTruthy();

  view.rerender(
    createElement(ExplorerDocumentInfoEditRangesSection, {
      documentInfo: createDocumentInfo({ attributionRevision: 8 }),
      loadDocumentAttributionRanges,
    }),
  );

  await waitFor(() =>
    expect(view.getByRole("button", { name: "Show edit ranges" })).toBeTruthy(),
  );
  expect(view.container.querySelector("table")).toBeNull();
  expect(requestCount).toBe(1);
});

test("closes and clears when the attribution manifest scope changes", async () => {
  let requestCount = 0;
  const loadDocumentAttributionRanges =
    async (): Promise<DocumentAttributionRangesPage> => {
      requestCount += 1;
      return {
        attributionRevision: 7,
        documentId: "document-1",
        hasMore: false,
        items: [
          {
            ...compactAttributionSegment,
            updateId: "old-scope-update",
          },
        ],
        nextCursor: null,
      };
    };
  const view = render(
    createElement(ExplorerDocumentInfoEditRangesSection, {
      documentInfo: createDocumentInfo(),
      loadDocumentAttributionRanges,
    }),
  );

  fireEvent.click(view.getByRole("button", { name: "Show edit ranges" }));
  expect(await view.findByText("old-scope-update")).toBeTruthy();

  view.rerender(
    createElement(ExplorerDocumentInfoEditRangesSection, {
      documentInfo: createDocumentInfo({
        currentManifestHash: "replacement-document-manifest-hash",
      }),
      loadDocumentAttributionRanges,
    }),
  );

  await waitFor(() =>
    expect(view.getByRole("button", { name: "Show edit ranges" })).toBeTruthy(),
  );
  expect(view.container.querySelector("table")).toBeNull();
  expect(requestCount).toBe(1);
});

test("ignores a stale page that resolves after the revision changes", async () => {
  let resolvePage: ((page: DocumentAttributionRangesPage) => void) | null =
    null;
  const pendingPage = new Promise<DocumentAttributionRangesPage>((resolve) => {
    resolvePage = resolve;
  });
  const view = render(
    createElement(ExplorerDocumentInfoEditRangesSection, {
      documentInfo: createDocumentInfo(),
      loadDocumentAttributionRanges: async () => pendingPage,
    }),
  );

  fireEvent.click(view.getByRole("button", { name: "Show edit ranges" }));
  expect(await view.findByText("Loading edit ranges...")).toBeTruthy();
  view.rerender(
    createElement(ExplorerDocumentInfoEditRangesSection, {
      documentInfo: createDocumentInfo({ attributionRevision: 8 }),
      loadDocumentAttributionRanges: async () => pendingPage,
    }),
  );

  await act(async () => {
    resolvePage?.({
      attributionRevision: 7,
      documentId: "document-1",
      hasMore: false,
      items: [
        {
          ...compactAttributionSegment,
          updateId: "stale-update",
        },
      ],
      nextCursor: null,
    });
    await pendingPage;
  });

  expect(view.getByRole("button", { name: "Show edit ranges" })).toBeTruthy();
  expect(view.queryByText("stale-update")).toBeNull();
  expect(view.container.querySelector("table")).toBeNull();
});

test("surfaces a page revision mismatch without mixing its rows", async () => {
  const requests: DocumentAttributionRangesInput[] = [];
  const loadDocumentAttributionRanges = async (
    input: DocumentAttributionRangesInput,
  ): Promise<DocumentAttributionRangesPage> => {
    requests.push(input);
    const isSecondPage = input.cursor === "next-page";
    const isRestart = requests.length === 3;
    return {
      attributionRevision: isSecondPage || isRestart ? 8 : 7,
      documentId: "document-1",
      hasMore: !isSecondPage && !isRestart,
      items: [
        {
          ...compactAttributionSegment,
          endCounter: isSecondPage || isRestart ? 2 : 1,
          startCounter: isSecondPage ? 1 : 0,
          updateId: isRestart
            ? "restarted-update"
            : isSecondPage
              ? "mismatched-update"
              : "first-update",
        },
      ],
      nextCursor: isSecondPage || isRestart ? null : "next-page",
    };
  };
  const view = render(
    createElement(ExplorerDocumentInfoEditRangesSection, {
      documentInfo: createDocumentInfo(),
      loadDocumentAttributionRanges,
    }),
  );

  fireEvent.click(view.getByRole("button", { name: "Show edit ranges" }));
  await view.findByText("first-update");
  fireEvent.click(view.getByRole("button", { name: "Load more" }));

  expect(
    await view.findByText("Edit attribution changed while loading. Try again."),
  ).toBeTruthy();
  expect(view.getByText("first-update")).toBeTruthy();
  expect(view.queryByText("mismatched-update")).toBeNull();
  expect(view.container.querySelectorAll("tbody tr")).toHaveLength(1);

  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  expect(await view.findByText("restarted-update")).toBeTruthy();
  expect(view.queryByText("first-update")).toBeNull();
  expect(requests.at(-1)).toEqual({
    cursor: null,
    documentId: "document-1",
    limit: 100,
  });
});

test("rejects an initial page from a newer compact attribution revision", async () => {
  const view = render(
    createElement(ExplorerDocumentInfoEditRangesSection, {
      documentInfo: createDocumentInfo({ attributionRevision: 7 }),
      loadDocumentAttributionRanges: async () => ({
        attributionRevision: 8,
        documentId: "document-1",
        hasMore: false,
        items: [
          {
            ...compactAttributionSegment,
            updateId: "newer-update",
          },
        ],
        nextCursor: null,
      }),
    }),
  );

  fireEvent.click(view.getByRole("button", { name: "Show edit ranges" }));

  expect(
    await view.findByText("Edit attribution changed while loading. Try again."),
  ).toBeTruthy();
  expect(view.queryByText("newer-update")).toBeNull();
  expect(view.container.querySelector("table")).toBeNull();
});

test("is hidden without compact attribution", () => {
  const view = render(
    createElement(ExplorerDocumentInfoEditRangesSection, {
      documentInfo: createDocumentInfo({ includeAttribution: false }),
      loadDocumentAttributionRanges: async () =>
        Promise.reject(new Error("Unexpected edit-ranges request.")),
    }),
  );

  expect(view.queryByRole("button", { name: "Show edit ranges" })).toBeNull();
});

test("truncated attribution hydrates paginated range writers", async () => {
  const documentInfo = createDocumentInfo();
  if (!documentInfo.remoteInfo) {
    throw new Error("Expected remote document info");
  }
  documentInfo.remoteInfo.attributionStatus = "truncated";
  documentInfo.remoteInfo.attributionSegments = [];
  const hydrationRequests: unknown[] = [];
  const view = render(
    createElement(ExplorerDocumentInfoEditRangesSection, {
      documentInfo,
      loadDocumentAttributionRanges: async () => ({
        attributionRevision: 7,
        documentId: "document-1",
        hasMore: false,
        items: [{ ...compactAttributionSegment, updateId: "page-update" }],
        nextCursor: null,
      }),
      requestAttributionProfileHydration: (request) => {
        hydrationRequests.push(request);
      },
    }),
  );

  fireEvent.click(view.getByRole("button", { name: "Show edit ranges" }));
  await waitFor(() =>
    expect(hydrationRequests).toEqual([
      { contributorUserIds: ["writer-1"], documentId: "document-1" },
    ]),
  );
});

test("is hidden for local-only documents", () => {
  const view = render(
    createElement(ExplorerDocumentInfoEditRangesSection, {
      documentInfo: createDocumentInfo({ localOnly: true }),
      loadDocumentAttributionRanges: async () =>
        Promise.reject(new Error("Unexpected edit-ranges request.")),
    }),
  );

  expect(view.queryByRole("button", { name: "Show edit ranges" })).toBeNull();
});

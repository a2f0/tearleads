import { afterEach, expect, test } from "bun:test";
import type { DocumentInfo } from "@tearleads/client-sdk";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ExplorerAttributionProfileHydrationRequester } from "../../hooks/explorerAttributionReadModel";
import { ExplorerDocumentInfoPanel } from "./ExplorerDocumentInfoPanel";
import {
  documentInfo,
  documentSummary,
  panelProps,
  renderDocumentInfoPanel,
} from "./ExplorerDocumentInfoPanel.testFixtures";

afterEach(() => cleanup());

test("document info hides edit ranges until the feature flag is enabled", async () => {
  const view = renderDocumentInfoPanel({
    fallbackDocumentSummary: documentSummary,
  });

  await view.findByText("Contributors");
  expect(view.queryByText("Edit Ranges")).toBeNull();
  expect(view.queryByRole("button", { name: "Show edit ranges" })).toBeNull();
});

test("document info requests profile hydration for its contributors", async () => {
  const requests: Parameters<ExplorerAttributionProfileHydrationRequester>[0][] =
    [];

  renderDocumentInfoPanel({
    fallbackDocumentSummary: documentSummary,
    requestAttributionProfileHydration: (request) => {
      requests.push(request);
    },
  });

  await waitFor(() =>
    expect(requests).toEqual([
      {
        contributorUserIds: ["writer-1"],
        documentId: "document-1",
      },
    ]),
  );
});

// Edit Ranges is flag-gated, so the truncated-attribution copy must not send
// viewers to a section most of them cannot see.
test("truncated attribution never points at the gated edit ranges", async () => {
  const view = renderDocumentInfoPanel({
    fallbackDocumentSummary: documentSummary,
    loadDocumentInfo: async () => ({
      ...documentInfo,
      remoteInfo: {
        ...documentInfo.remoteInfo,
        attributionStatus: "truncated",
      },
    }),
  });

  expect(
    await view.findByText(
      "Edit attribution is too large for a complete summary.",
    ),
  ).toBeTruthy();
  expect(view.queryByText(/Edit Ranges/)).toBeNull();
});

test("document info does not load detailed edit ranges until requested", async () => {
  let rangeRequestCount = 0;
  const view = renderDocumentInfoPanel({
    fallbackDocumentSummary: documentSummary,
    showDocumentEditRanges: true,
    loadDocumentAttributionRanges: async () => {
      rangeRequestCount += 1;
      return {
        attributionRevision: 7,
        documentId: "document-1",
        hasMore: false,
        items: [
          {
            authorityKind: "direct",
            endCounter: 7,
            peerId: "peer-1",
            startCounter: 0,
            updateId: "update-1",
            writerKeyFingerprint: "writer-fingerprint-1",
            writerUserId: "writer-1",
          },
        ],
        nextCursor: null,
      };
    },
  });

  await view.findByRole("button", { name: "Show edit ranges" });
  expect(rangeRequestCount).toBe(0);
  fireEvent.click(view.getByRole("button", { name: "Show edit ranges" }));

  await waitFor(() => expect(rangeRequestCount).toBe(1));
  expect(view.getByText("update-1")).toBeTruthy();
});

test("document info links tab renders linked containers", async () => {
  const view = renderDocumentInfoPanel({
    fallbackDocumentSummary: documentSummary,
  });

  expect(view.queryByText("Linked Containers")).toBeNull();
  fireEvent.click(view.getByRole("tab", { name: "Links" }));

  await waitFor(() => {
    expect(
      view.getByRole("button", {
        name: "Open linked container Archive",
      }),
    ).toBeTruthy();
  });
  expect(view.queryByText("Active")).toBeNull();
  expect(
    view.queryByRole("button", { name: /make linked container/i }),
  ).toBeNull();
  expect(view.getByText("Authorizing Containers")).toBeTruthy();
});

test("document info links tab restores activation controls when enabled", async () => {
  const activatedContainers: Array<[string, string]> = [];
  const view = renderDocumentInfoPanel({
    activateLinkedContainer: async (documentId, targetContainerId) => {
      activatedContainers.push([documentId, targetContainerId]);
      return { ...documentSummary, containerId: targetContainerId };
    },
    fallbackDocumentSummary: documentSummary,
    showLinkedDocumentActivationControls: true,
  });

  fireEvent.click(view.getByRole("tab", { name: "Links" }));

  await waitFor(() => {
    expect(view.getByText("Active")).toBeTruthy();
  });
  fireEvent.click(
    view.getByRole("button", {
      name: "Make linked container Archive active",
    }),
  );

  await waitFor(() => {
    expect(activatedContainers).toEqual([
      ["local-document-1", "archive-container"],
    ]);
  });
});

test("document info loads a summary for the routed document", async () => {
  const loadedLocalIds: string[] = [];
  renderDocumentInfoPanel({
    fallbackDocumentSummary: null,
    loadDocumentSummary: async (localId) => {
      loadedLocalIds.push(localId);
      return documentSummary;
    },
  });

  await waitFor(() => {
    expect(loadedLocalIds).toEqual(["local-document-1"]);
  });
});

test("document info hides a prior document while the next document loads", async () => {
  const pendingDocumentInfo = new Promise<DocumentInfo>(() => undefined);
  const loadDocumentInfo = (localId: string): Promise<DocumentInfo> =>
    localId === "local-document-1"
      ? Promise.resolve(documentInfo)
      : pendingDocumentInfo;
  const view = renderDocumentInfoPanel({
    fallbackDocumentSummary: documentSummary,
    loadDocumentInfo,
  });
  await view.findByTitle("document-1");

  view.rerender(
    createElement(
      ExplorerDocumentInfoPanel,
      panelProps({
        fallbackDocumentSummary: null,
        loadDocumentInfo,
        loadDocumentSummary: async () => null,
        localId: "local-document-2",
      }),
    ),
  );

  expect(view.queryByTitle("document-1")).toBeNull();
  expect(view.getByText("Loading...")).toBeTruthy();
});

test("document info retains same-document data during a refresh", async () => {
  const view = renderDocumentInfoPanel({
    fallbackDocumentSummary: documentSummary,
  });
  await view.findByTitle("document-1");

  view.rerender(
    createElement(
      ExplorerDocumentInfoPanel,
      panelProps({
        fallbackDocumentSummary: documentSummary,
        loadDocumentInfo: async () =>
          new Promise<DocumentInfo>(() => undefined),
      }),
    ),
  );

  expect(view.getByTitle("document-1")).toBeTruthy();
  expect(view.queryByText("Loading...")).toBeNull();
});

test("one trailing same-document refresh wins over its in-flight predecessor", async () => {
  let resolveInitial: ((info: DocumentInfo) => void) | undefined;
  let resolveRefresh: ((info: DocumentInfo) => void) | undefined;
  const initial = new Promise<DocumentInfo>((resolve) => {
    resolveInitial = resolve;
  });
  const refresh = new Promise<DocumentInfo>((resolve) => {
    resolveRefresh = resolve;
  });
  let loadCount = 0;
  const view = renderDocumentInfoPanel({
    fallbackDocumentSummary: documentSummary,
    loadDocumentInfo: () => {
      loadCount += 1;
      return initial;
    },
  });

  await waitFor(() => expect(loadCount).toBe(1));
  view.rerender(
    createElement(
      ExplorerDocumentInfoPanel,
      panelProps({
        fallbackDocumentSummary: {
          ...documentSummary,
          updatedAt: "2026-06-20T10:00:01.000Z",
        },
        loadDocumentInfo: () => {
          throw new Error("Superseded refresh must not start.");
        },
      }),
    ),
  );
  view.rerender(
    createElement(
      ExplorerDocumentInfoPanel,
      panelProps({
        fallbackDocumentSummary: {
          ...documentSummary,
          updatedAt: "2026-06-20T10:00:02.000Z",
        },
        loadDocumentInfo: () => {
          loadCount += 1;
          return refresh;
        },
      }),
    ),
  );

  expect(loadCount).toBe(1);
  await act(async () => {
    resolveInitial?.({
      ...documentInfo,
      local: { ...documentInfo.local, updatedAt: "stale" },
    });
  });
  await waitFor(() => expect(loadCount).toBe(2));
  expect(view.queryByTitle("stale")).toBeNull();

  await act(async () => {
    resolveRefresh?.({
      ...documentInfo,
      local: { ...documentInfo.local, updatedAt: "fresh" },
    });
  });
  expect(view.getByTitle("fresh")).toBeTruthy();
  expect(view.queryByTitle("stale")).toBeNull();
  expect(loadCount).toBe(2);
});

test("cross-document navigation starts immediately and ignores the old response", async () => {
  let resolveFirst: ((info: DocumentInfo) => void) | undefined;
  const first = new Promise<DocumentInfo>((resolve) => {
    resolveFirst = resolve;
  });
  const loadedLocalIds: string[] = [];
  const view = renderDocumentInfoPanel({
    fallbackDocumentSummary: documentSummary,
    loadDocumentInfo: async (localId) => {
      loadedLocalIds.push(localId);
      return first;
    },
  });
  await waitFor(() => expect(loadedLocalIds).toEqual(["local-document-1"]));

  view.rerender(
    createElement(
      ExplorerDocumentInfoPanel,
      panelProps({
        fallbackDocumentSummary: null,
        loadDocumentInfo: async (localId) => {
          loadedLocalIds.push(localId);
          return {
            ...documentInfo,
            local: {
              ...documentInfo.local,
              documentId: "document-2",
              localId,
            },
          };
        },
        localId: "local-document-2",
      }),
    ),
  );

  await waitFor(() =>
    expect(loadedLocalIds).toEqual(["local-document-1", "local-document-2"]),
  );
  expect(await view.findByTitle("document-2")).toBeTruthy();
  await act(async () => {
    resolveFirst?.(documentInfo);
  });
  expect(view.getByTitle("document-2")).toBeTruthy();
  expect(view.queryByTitle("document-1")).toBeNull();
});

test("document info reports a thrown detach and keeps the row's error label", async () => {
  const failure = new Error("detach failed");
  const logged: Array<[string | Error, unknown]> = [];
  const view = renderDocumentInfoPanel({
    fallbackDocumentSummary: documentSummary,
    logError: (message, cause) => {
      logged.push([message, cause]);
    },
    unlinkDocument: async () => {
      throw failure;
    },
  });

  fireEvent.click(view.getByRole("tab", { name: "Links" }));
  await waitFor(() => {
    expect(
      view.getByRole("button", { name: "Detach linked container Archive" }),
    ).toBeTruthy();
  });
  fireEvent.click(
    view.getByRole("button", { name: "Detach linked container Archive" }),
  );

  await waitFor(() => {
    expect(logged).toEqual([
      ["Failed to detach the linked explorer container", failure],
    ]);
  });
  expect(view.getByText(/Failed to detach/)).toBeTruthy();
});

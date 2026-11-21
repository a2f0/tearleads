import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  DocumentHistory,
  DocumentHistoryChange,
  DocumentHistoryView,
  DocumentSummary,
  Tearleads,
} from "@tearleads/client-sdk";
import { act, cleanup, render } from "@testing-library/react";
import * as Runtime from "../../../../providers/sdk/TearleadsProvider";
import * as History from "../../../../stores/document-history/useDocumentHistory";
import * as Documents from "../../../../stores/documents/DocumentsProvider";
import { ExplorerDocumentHistoryPanel } from "./ExplorerDocumentHistoryPanel";
import type { ExplorerDocumentVersionCopy } from "./useExplorerDocumentVersionCopy";

/** These tests never reach the timeline's actions. */
const NO_VERSION_COPY: ExplorerDocumentVersionCopy = {
  canSave: () => false,
  open: () => undefined,
  save: async () => null,
  scope: {},
};

const restorers: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const restore of restorers.splice(0)) restore();
});

const VIEW: DocumentHistoryView = {
  attachments: [],
  documentKind: "note",
  fieldValidationIssues: [],
  rows: [],
  structuredFields: {},
  text: "a past version",
  title: "a past version",
};
const NO_CHANGE: DocumentHistoryChange = {
  attachments: { added: [], removed: [], replaced: [] },
  fields: [],
  kindChanged: false,
  rows: { added: [], changed: [], removed: [] },
  text: null,
};
const HISTORY: DocumentHistory = {
  changeAt: () => NO_CHANGE,
  close: () => undefined,
  stops: [0, 1].map((index) => ({
    committedAt: index * 1000,
    endCounter: index + 1,
    index,
    peerId: "1",
    startCounter: index,
  })),
  versionAt: () => [],
  viewAt: () => VIEW,
};

/** The SDK's save notifications, with a way to announce one. */
function documentSaves() {
  const listeners = new Set<(document: DocumentSummary) => void>();
  const spy = spyOn(Runtime, "useTearleads").mockReturnValue({
    documents: {
      subscribe: (listener: (document: DocumentSummary) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  } as unknown as Tearleads);
  restorers.push(() => spy.mockRestore());
  return {
    announce: (localId: string) => {
      for (const listener of [...listeners]) {
        listener({ id: localId } as DocumentSummary);
      }
    },
  };
}

function summary(containerId: string | null): DocumentSummary {
  return {
    containerId,
    documentId: "remote-1",
    documentKind: "note",
    id: "local-1",
    title: "Note",
    updatedAt: "2030-01-01T00:00:00.000Z",
  } as DocumentSummary;
}

/**
 * Render the panel with history ready on a past stop, and capture the
 * read-only flag it gives the live document's provider.
 */
function mountPanel(input: {
  documentSummary: DocumentSummary;
  readOnlyContainers: ReadonlySet<string>;
}) {
  const asked: Array<string | null> = [];
  const historySpy = spyOn(History, "useDocumentHistory").mockReturnValue({
    reload: () => undefined,
    seek: () => undefined,
    state: {
      history: HISTORY,
      newerAvailable: false,
      playing: false,
      run: 1,
      selectedIndex: 0,
      shown: { change: NO_CHANGE, index: 0, view: VIEW },
      status: "ready",
    },
    step: () => undefined,
    togglePlay: () => undefined,
  });
  const providerSpy = spyOn(Documents, "DocumentsProvider").mockImplementation(
    ({ readOnly }) => (
      <div data-read-only={String(readOnly)} data-testid="live-document" />
    ),
  );
  restorers.push(
    () => historySpy.mockRestore(),
    () => providerSpy.mockRestore(),
  );
  const view = render(
    <ExplorerDocumentHistoryPanel
      fallbackDocumentSummary={input.documentSummary}
      isContainerReadOnly={(containerId) => {
        asked.push(containerId);
        return (
          containerId !== null && input.readOnlyContainers.has(containerId)
        );
      }}
      loadDocumentSummary={async () => input.documentSummary}
      localId="local-1"
      versionCopy={NO_VERSION_COPY}
    />,
  );
  return {
    asked,
    readOnly: () =>
      view.getByTestId("live-document").getAttribute("data-read-only"),
  };
}

test("History is read-only when the document's own folder is, whatever route opened it", () => {
  // Opened from a stale or bookmarked route that named a writable folder;
  // the document has since moved to the Trash.
  const panel = mountPanel({
    documentSummary: summary("trash"),
    readOnlyContainers: new Set(["trash"]),
  });

  expect(panel.readOnly()).toBe("true");
  // The question is asked about where the document is, and nowhere else.
  expect(new Set(panel.asked)).toEqual(new Set(["trash"]));
});

test("a document the route was refused never has its history opened", async () => {
  documentSaves();
  const historySpy = spyOn(History, "useDocumentHistory");
  restorers.push(() => historySpy.mockRestore());
  // No summary to fall back on, and the routed loader refuses the document:
  // an orphan the active organization does not own.
  const view = render(
    <ExplorerDocumentHistoryPanel
      fallbackDocumentSummary={null}
      isContainerReadOnly={() => false}
      loadDocumentSummary={async () => null}
      localId="local-1"
      versionCopy={NO_VERSION_COPY}
    />,
  );

  await view.findByText("This document is not available.");
  // Not while the summary was loading, and not after it was refused: the
  // history holds the document's content, and its title is content too.
  expect(historySpy).not.toHaveBeenCalled();
  expect(view.container.textContent).not.toContain("a past version");
});

test("a document whose summary failed to load never has its history opened", async () => {
  documentSaves();
  const historySpy = spyOn(History, "useDocumentHistory");
  restorers.push(() => historySpy.mockRestore());
  const view = render(
    <ExplorerDocumentHistoryPanel
      fallbackDocumentSummary={null}
      isContainerReadOnly={() => false}
      loadDocumentSummary={async () => {
        throw new Error("database closed");
      }}
      localId="local-1"
      versionCopy={NO_VERSION_COPY}
    />,
  );

  await view.findByText("History could not be loaded: database closed");
  expect(historySpy).not.toHaveBeenCalled();
});

test("a cold link opens History once the document hydrates", async () => {
  const saves = documentSaves();
  const historySpy = spyOn(History, "useDocumentHistory").mockReturnValue({
    reload: () => undefined,
    seek: () => undefined,
    state: { run: 1, status: "loading" },
    step: () => undefined,
    togglePlay: () => undefined,
  });
  restorers.push(() => historySpy.mockRestore());
  // The link was opened before the document reached this device: the loader
  // has no summary for it yet.
  let hydrated: DocumentSummary | null = null;
  const view = render(
    <ExplorerDocumentHistoryPanel
      fallbackDocumentSummary={null}
      isContainerReadOnly={() => false}
      loadDocumentSummary={async () => hydrated}
      localId="local-1"
      versionCopy={NO_VERSION_COPY}
    />,
  );
  await view.findByText("This document is not available.");
  expect(historySpy).not.toHaveBeenCalled();

  // A save of another document changes nothing.
  hydrated = summary("folder");
  await act(async () => saves.announce("other"));
  expect(historySpy).not.toHaveBeenCalled();

  // The document hydrates and is saved: its summary is asked for again.
  await act(async () => saves.announce("local-1"));
  expect(historySpy).toHaveBeenCalledWith("local-1");
  expect(view.queryByText("This document is not available.")).toBeNull();
});

test("History is writable when the document's folder is", () => {
  const panel = mountPanel({
    documentSummary: summary("folder"),
    readOnlyContainers: new Set(["trash"]),
  });

  expect(panel.readOnly()).toBe("false");
});

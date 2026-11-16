import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  DocumentHistory,
  DocumentHistoryChange,
  DocumentHistoryView,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import * as History from "../../../../stores/document-history/useDocumentHistory";
import * as Documents from "../../../../stores/documents/DocumentsProvider";
import { ExplorerDocumentHistoryPanel } from "./ExplorerDocumentHistoryPanel";

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

test("History is writable when the document's folder is", () => {
  const panel = mountPanel({
    documentSummary: summary("folder"),
    readOnlyContainers: new Set(["trash"]),
  });

  expect(panel.readOnly()).toBe("false");
});

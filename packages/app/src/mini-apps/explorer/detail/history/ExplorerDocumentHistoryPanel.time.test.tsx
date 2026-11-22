import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  DocumentHistory,
  DocumentHistoryChange,
  DocumentHistoryView,
  DocumentSnapshot,
  DocumentStore,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import * as Registry from "../../../../document-types/registry";
import * as History from "../../../../stores/document-history/useDocumentHistory";
import * as Documents from "../../../../stores/documents/DocumentsProvider";
import * as Ranges from "../../../../stores/documents/useDocumentAttributionRanges";
import * as RowWriters from "../../../../stores/documents/useDocumentRowWriters";
import { formatMiniAppDateTimeSeconds } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
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
const SUMMARY: DocumentSummary = {
  containerId: "folder",
  documentId: "remote-1",
  documentKind: "note",
  id: "local-1",
  title: "Note",
  updatedAt: "2030-01-01T00:00:00.000Z",
};
/** A live document that is ready and cannot be written. */
const LIVE_SNAPSHOT: DocumentSnapshot = {
  attachments: [],
  attachmentStatusBySlotId: {},
  attachmentStorageKeyBySlotId: {},
  canAttach: false,
  canWrite: false,
  currentAuthorId: "user-1",
  documentId: "remote-1",
  documentKind: "note",
  effectiveAccessLevel: "read",
  fieldValidationIssues: [],
  ready: true,
  rows: [],
  structuredFields: {},
  syncing: false,
  text: "",
  title: "",
};
const LIVE_DOCUMENT = {
  getSnapshot: () => LIVE_SNAPSHOT,
  subscribe: () => () => undefined,
} as unknown as DocumentStore;

/**
 * Render History on one change: `committedAt` is the time its device
 * recorded, and `storedAt` when the server stored the upload that delivered
 * it (null when no upload has).
 */
function mountChange(input: { committedAt: number; storedAt: string | null }) {
  const history: DocumentHistory = {
    changeAt: () => NO_CHANGE,
    close: () => undefined,
    stops: [
      {
        committedAt: input.committedAt,
        endCounter: 5,
        index: 0,
        peerId: "7",
        startCounter: 0,
      },
    ],
    versionAt: () => [],
    viewAt: () => VIEW,
  };
  const spies = [
    spyOn(History, "useDocumentHistory").mockReturnValue({
      reload: () => undefined,
      seek: () => undefined,
      state: {
        history,
        newerAvailable: false,
        playing: false,
        run: 1,
        selectedIndex: 0,
        shown: { change: NO_CHANGE, index: 0, view: VIEW },
        status: "ready",
      },
      step: () => undefined,
      togglePlay: () => undefined,
    }),
    // The live document's provider, without opening a store.
    spyOn(Documents, "DocumentsProvider").mockImplementation(({ children }) => (
      <Documents.DocumentContext.Provider value={LIVE_DOCUMENT}>
        {children}
      </Documents.DocumentContext.Provider>
    )),
    spyOn(Ranges, "useDocumentAttributionRanges").mockReturnValue(
      input.storedAt === null
        ? []
        : [
            {
              authorityKind: "direct",
              createdAt: input.storedAt,
              endCounter: 5,
              peerId: "7",
              signedAt: input.storedAt,
              startCounter: 0,
              updateId: "update-1",
              writerKeyFingerprint: "0123456789abcdef0123456789abcdef",
              writerUserId: "ada",
            },
          ],
    ),
    // Who uploaded the change is a separate read, not under test here.
    spyOn(RowWriters, "useDocumentAttributionSegments").mockReturnValue([]),
    spyOn(Registry, "getDocumentTypeDefinition").mockReturnValue({
      App: () => <div data-testid="document-at-stop" />,
    } as unknown as ReturnType<typeof Registry.getDocumentTypeDefinition>),
  ];
  restorers.push(...spies.map((spy) => () => spy.mockRestore()));
  const view = render(
    <ExplorerDocumentHistoryPanel
      fallbackDocumentSummary={SUMMARY}
      isContainerReadOnly={() => false}
      loadDocumentSummary={async () => SUMMARY}
      localId="local-1"
      versionCopy={{
        canSave: () => false,
        open: () => undefined,
        save: async () => null,
        scope: {},
      }}
    />,
  );
  return {
    ...view,
    shownTime: () =>
      view.container.querySelector(".explorer-document-history-caption strong")
        ?.textContent,
  };
}

const STORED = "2030-01-01T10:00:00.000Z";
const STORED_AT = Date.parse(STORED);

test("a change made before its upload shows the time its device recorded", () => {
  const recorded = STORED_AT - 90_000;
  const view = mountChange({ committedAt: recorded, storedAt: STORED });

  expect(view.shownTime()).toBe(formatMiniAppDateTimeSeconds(recorded));
  expect(
    view.queryByText(EXPLORER_LABELS.documentHistoryClockAhead),
  ).toBeNull();
});

test("a change recorded a day after its upload shows the upload, and says why", () => {
  const view = mountChange({
    committedAt: STORED_AT + 24 * 60 * 60 * 1000,
    storedAt: STORED,
  });

  // It cannot have been made after the server stored it.
  expect(view.shownTime()).toBe(formatMiniAppDateTimeSeconds(STORED_AT));
  expect(
    view.getByText(EXPLORER_LABELS.documentHistoryClockAhead),
  ).toBeTruthy();
});

test("a clock a few seconds ahead is corrected without comment", () => {
  const view = mountChange({
    committedAt: STORED_AT + 3_000,
    storedAt: STORED,
  });

  expect(view.shownTime()).toBe(formatMiniAppDateTimeSeconds(STORED_AT));
  expect(
    view.queryByText(EXPLORER_LABELS.documentHistoryClockAhead),
  ).toBeNull();
});

test("a change no upload has delivered shows its device's time, unbounded", () => {
  // Offline, unsynced, or attribution unavailable.
  const recorded = STORED_AT + 24 * 60 * 60 * 1000;
  const view = mountChange({ committedAt: recorded, storedAt: null });

  expect(view.shownTime()).toBe(formatMiniAppDateTimeSeconds(recorded));
  expect(
    view.queryByText(EXPLORER_LABELS.documentHistoryClockAhead),
  ).toBeNull();
});

import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  DocumentHistory,
  DocumentHistoryChange,
  DocumentHistoryView,
  DocumentSnapshot,
  DocumentStore,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useEffect } from "react";
import * as Registry from "../../../../document-types/registry";
import * as History from "../../../../stores/document-history/useDocumentHistory";
import * as Verification from "../../../../stores/document-history/useDocumentHistoryVerification";
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

/** The upload ranges History is given: none, or one stored at `storedAt`. */
function uploadsStoredAt(storedAt: string | null) {
  return storedAt === null
    ? []
    : [
        {
          authorityKind: "direct" as const,
          createdAt: storedAt,
          endCounter: 5,
          peerId: "7",
          signedAt: storedAt,
          startCounter: 0,
          updateId: "update-1",
          writerKeyFingerprint: "0123456789abcdef0123456789abcdef",
          writerUserId: "ada",
        },
      ];
}

/**
 * Render History on one change: `committedAt` is the time its device
 * recorded, and `storedAt` when the server stored the upload that delivered
 * it (null when no upload has). `pending` starts with the uploads' first read
 * not settled. The returned controls change what the history and the uploads
 * read say, and count how often the uploads read was mounted.
 */
function mountChange(input: {
  committedAt: number;
  /** The folder takes a copy of the version, so Save as copy is offered. */
  copyable?: boolean;
  pending?: boolean;
  storedAt: string | null;
}) {
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
  const ready: ReturnType<typeof History.useDocumentHistory>["state"] = {
    history,
    newerAvailable: false,
    playing: false,
    run: 1,
    selectedIndex: 0,
    shown: { change: NO_CHANGE, index: 0, view: VIEW },
    source: "local",
    status: "ready",
  };
  const current: {
    state: ReturnType<typeof History.useDocumentHistory>["state"];
    uploads: ReturnType<typeof uploadsStoredAt> | null;
  } = {
    state: ready,
    uploads: input.pending ? null : uploadsStoredAt(input.storedAt),
  };
  let uploadReadMounts = 0;
  const spies = [
    spyOn(History, "useDocumentHistory").mockImplementation(() => ({
      reload: () => undefined,
      seek: () => undefined,
      showLocal: () => undefined,
      showSigned: () => undefined,
      state: current.state,
      step: () => undefined,
      togglePlay: () => undefined,
    })),
    // The history is never checked here: the times are the server's.
    spyOn(Verification, "useDocumentHistoryVerification").mockReturnValue({
      state: { status: "idle" },
      verify: () => undefined,
    }),
    // The live document's provider, without opening a store.
    spyOn(Documents, "DocumentsProvider").mockImplementation(({ children }) => (
      <Documents.DocumentContext.Provider value={LIVE_DOCUMENT}>
        {children}
      </Documents.DocumentContext.Provider>
    )),
    spyOn(Ranges, "useDocumentAttributionRanges").mockImplementation(() => {
      useEffect(() => {
        uploadReadMounts += 1;
      }, []);
      return current.uploads;
    }),
    // Who uploaded the change is a separate read, not under test here.
    spyOn(RowWriters, "useDocumentAttributionSegments").mockReturnValue([]),
    spyOn(Registry, "getDocumentTypeDefinition").mockReturnValue({
      App: () => <div data-testid="document-at-stop" />,
    } as unknown as ReturnType<typeof Registry.getDocumentTypeDefinition>),
  ];
  restorers.push(...spies.map((spy) => () => spy.mockRestore()));
  const versionCopy = {
    canSave: () => input.copyable === true,
    open: () => undefined,
    save: async () => null,
    scope: {},
  };
  const panel = () => (
    <ExplorerDocumentHistoryPanel
      fallbackDocumentSummary={SUMMARY}
      isContainerReadOnly={() => false}
      loadDocumentSummary={async () => SUMMARY}
      localId="local-1"
      versionCopy={versionCopy}
    />
  );
  const view = render(panel());
  function update(next: Partial<typeof current>) {
    Object.assign(current, next);
    act(() => view.rerender(panel()));
  }
  return {
    ...view,
    /** History reloads, as after a restore or "Load newer edits". */
    reload: () => {
      update({ state: { run: 2, status: "loading" } });
      update({ state: { ...ready, run: 2 } });
    },
    settleUploads: () => update({ uploads: uploadsStoredAt(input.storedAt) }),
    uploadReadMounts: () => uploadReadMounts,
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

test("the time waits for the uploads' first read, then shows bounded", () => {
  const view = mountChange({
    committedAt: STORED_AT + 24 * 60 * 60 * 1000,
    pending: true,
    storedAt: STORED,
  });

  // Not the device's time, a day ahead, which the read would then change.
  expect(view.shownTime()).toBe(EXPLORER_LABELS.documentHistoryTimeChecking);
  expect(
    view.queryByText(EXPLORER_LABELS.documentHistoryClockAhead),
  ).toBeNull();

  view.settleUploads();
  expect(view.shownTime()).toBe(formatMiniAppDateTimeSeconds(STORED_AT));
  expect(
    view.getByText(EXPLORER_LABELS.documentHistoryClockAhead),
  ).toBeTruthy();
});

test("a confirmation opened before the time is known names none while open", () => {
  const view = mountChange({
    committedAt: STORED_AT + 24 * 60 * 60 * 1000,
    copyable: true,
    pending: true,
    storedAt: STORED,
  });
  const saveAsCopy = () =>
    fireEvent.click(
      view.getByRole("button", {
        name: EXPLORER_LABELS.documentHistoryCopyAction,
      }),
    );
  const message = () => view.getByRole("dialog").textContent;

  // Not the device's time, a day ahead, and not the upload's once it is read:
  // the text does not change while it is read.
  saveAsCopy();
  expect(message()).toContain("rows of this version.");
  view.settleUploads();
  expect(view.shownTime()).toBe(formatMiniAppDateTimeSeconds(STORED_AT));
  expect(message()).toContain("rows of this version.");

  // Asked again, it names the time now shown.
  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentHistoryCopyCancel,
    }),
  );
  saveAsCopy();
  expect(message()).toContain(
    `rows this one had at ${formatMiniAppDateTimeSeconds(STORED_AT)}.`,
  );
});

test("History reloading keeps the uploads it read", () => {
  const view = mountChange({ committedAt: STORED_AT, storedAt: STORED });
  expect(view.uploadReadMounts()).toBe(1);

  view.reload();

  // Read above the reload, through the live document that stays open.
  expect(view.uploadReadMounts()).toBe(1);
  expect(view.shownTime()).toBe(formatMiniAppDateTimeSeconds(STORED_AT));
});

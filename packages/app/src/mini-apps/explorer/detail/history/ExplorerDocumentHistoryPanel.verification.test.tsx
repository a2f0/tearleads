import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  DocumentHistory,
  DocumentHistoryChange,
  DocumentHistoryVerificationReport,
  DocumentHistoryView,
  DocumentStore,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as Registry from "../../../../document-types/registry";
import type { DocumentHistoryVerificationState } from "../../../../stores/document-history/documentHistoryVerificationMachine";
import * as History from "../../../../stores/document-history/useDocumentHistory";
import * as Verification from "../../../../stores/document-history/useDocumentHistoryVerification";
import * as Documents from "../../../../stores/documents/DocumentsProvider";
import * as Ranges from "../../../../stores/documents/useDocumentAttributionRanges";
import * as RowWriters from "../../../../stores/documents/useDocumentRowWriters";
import { formatMiniAppDateTimeSeconds } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerDocumentHistoryPanel } from "./ExplorerDocumentHistoryPanel";

type HistoryState = ReturnType<typeof History.useDocumentHistory>["state"];

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
const LIVE_SNAPSHOT = { canWrite: false, documentId: "remote-1", ready: true };
const LIVE_DOCUMENT = {
  getSnapshot: () => LIVE_SNAPSHOT,
  subscribe: () => () => undefined,
} as unknown as DocumentStore;

/** A replay of one change: operations 0 to 4 of peer 7, made at `madeAt`. */
function replay(madeAt: number): DocumentHistory {
  return {
    changeAt: () => NO_CHANGE,
    close: () => undefined,
    stops: [
      {
        committedAt: madeAt,
        endCounter: 5,
        index: 0,
        peerId: "7",
        startCounter: 0,
      },
    ],
    versionAt: () => [],
    viewAt: () => VIEW,
  };
}

const SERVER_STORED = "2030-01-01T10:00:00.000Z";
const VERIFIED_STORED = "2030-01-01T09:00:00.000Z";
/** The change's device recorded a time after both uploads. */
const MADE_AT = Date.parse(SERVER_STORED) + 3_600_000;
const LOCAL = replay(MADE_AT);
const SIGNED = replay(MADE_AT);

/** One upload of the whole change, as the server or a verification names it. */
function upload(input: {
  authorityKind?: "baseline" | "direct";
  createdAt: string;
  writerUserId: string;
}) {
  return {
    authorityKind: input.authorityKind ?? ("direct" as const),
    createdAt: input.createdAt,
    endCounter: 5,
    peerId: "7",
    signedAt: input.createdAt,
    startCounter: 0,
    updateId: `update-${input.writerUserId}`,
    writerKeyFingerprint: "0123456789abcdef0123456789abcdef",
    writerUserId: input.writerUserId,
  };
}

const SERVER_UPLOAD = upload({ createdAt: SERVER_STORED, writerUserId: "ada" });

function report(
  overrides: Partial<DocumentHistoryVerificationReport> = {},
): DocumentHistoryVerificationReport {
  return {
    localVersion: [],
    ranges: [upload({ createdAt: VERIFIED_STORED, writerUserId: "grace" })],
    serverAhead: false,
    voidUpdateCount: 0,
    ...overrides,
  };
}

const IDLE: DocumentHistoryVerificationState = { status: "idle" };
const MISMATCH: DocumentHistoryVerificationState = {
  report: report(),
  run: 1,
  signed: SIGNED,
  status: "mismatch",
};

function ready(source: "local" | "signed"): HistoryState {
  const shared = {
    newerAvailable: false,
    playing: false,
    run: 1,
    selectedIndex: 0,
    shown: { change: NO_CHANGE, index: 0, view: VIEW },
    status: "ready" as const,
  };
  return source === "local"
    ? { ...shared, history: LOCAL, source }
    : { ...shared, history: SIGNED, local: LOCAL, source };
}

/**
 * Render History on one change with `verification` as the check's state.
 * The server's own attribution names Ada and the upload stored at
 * `SERVER_STORED`. Asking for the signed replay, or for the device's copy,
 * changes which history is on screen, as the real controls do.
 */
function mount(verification: DocumentHistoryVerificationState = IDLE) {
  const current = { history: ready("local"), verification };
  const verify = { count: 0 };
  const captures: Array<DocumentHistory | null> = [];
  const shownSigned: DocumentHistory[] = [];
  let rerender: () => void = () => undefined;
  const show = (history: HistoryState) => {
    current.history = history;
    rerender();
  };
  const spies = [
    spyOn(History, "useDocumentHistory").mockImplementation(() => ({
      reload: () => undefined,
      seek: () => undefined,
      showLocal: () => show(ready("local")),
      showSigned: (signed) => {
        shownSigned.push(signed);
        show(ready("signed"));
      },
      state: current.history,
      step: () => undefined,
      togglePlay: () => undefined,
    })),
    spyOn(Verification, "useDocumentHistoryVerification").mockImplementation(
      (_localId, capture) => {
        captures.push(capture);
        return {
          state: current.verification,
          verify: () => {
            verify.count += 1;
          },
        };
      },
    ),
    spyOn(Documents, "DocumentsProvider").mockImplementation(({ children }) => (
      <Documents.DocumentContext.Provider value={LIVE_DOCUMENT}>
        {children}
      </Documents.DocumentContext.Provider>
    )),
    spyOn(Ranges, "useDocumentAttributionRanges").mockReturnValue([
      SERVER_UPLOAD,
    ]),
    spyOn(RowWriters, "useDocumentAttributionSegments").mockReturnValue([
      SERVER_UPLOAD,
    ]),
    spyOn(Registry, "getDocumentTypeDefinition").mockReturnValue({
      App: () => <div data-testid="document-at-stop" />,
    } as unknown as ReturnType<typeof Registry.getDocumentTypeDefinition>),
  ];
  restorers.push(...spies.map((spy) => () => spy.mockRestore()));
  const panel = () => (
    <ExplorerDocumentHistoryPanel
      attributionUserLabelResolver={(userId) => userId ?? null}
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
    />
  );
  const view = render(panel());
  rerender = () => act(() => view.rerender(panel()));
  return {
    ...view,
    button: (name: string) => view.queryByRole("button", { name }),
    caption: () =>
      view.container.querySelector(".explorer-document-history-caption")
        ?.textContent ?? "",
    captures,
    /** The check's status line: one live region, whatever it says. */
    status: () =>
      view.container.querySelector(
        ".explorer-document-history-verification [role=status]",
      ),
    shownSigned,
    shownTime: () =>
      view.container.querySelector(".explorer-document-history-caption strong")
        ?.textContent,
    verify,
  };
}

const UNAVAILABLE = EXPLORER_LABELS.documentHistoryVerifyUnavailable;
const AGAIN = EXPLORER_LABELS.documentHistoryVerifyAgainAction;

/** `[state, the status line's text, the action offered]`. */
const STATUSES: ReadonlyArray<
  readonly [DocumentHistoryVerificationState, string, string]
> = [
  [
    IDLE,
    "This is the history stored on this device. It has not been checked.",
    "Verify history",
  ],
  [
    { report: report(), run: 1, status: "verified" },
    "Checked against the signed uploads the server holds. This device's copy matches.",
    AGAIN,
  ],
  [
    {
      report: report({ serverAhead: true, voidUpdateCount: 1 }),
      run: 1,
      status: "verified",
    },
    "Checked against the signed uploads the server holds. This device's copy matches. The server also holds newer edits. 1 upload was set aside as void.",
    AGAIN,
  ],
  [
    { report: report({ voidUpdateCount: 3 }), run: 1, status: "verified" },
    "Checked against the signed uploads the server holds. This device's copy matches. 3 uploads were set aside as void.",
    AGAIN,
  ],
  [MISMATCH, "This device's copy differs from the signed uploads.", AGAIN],
  [
    { reason: "offline", run: 1, status: "unavailable" },
    "Can't check while offline.",
    AGAIN,
  ],
  [
    { reason: "not_synced", run: 1, status: "unavailable" },
    "Nothing has been uploaded yet.",
    AGAIN,
  ],
  [
    {
      contentKeyEpoch: 2,
      reason: "epoch_key_unreachable",
      run: 1,
      status: "unavailable",
    },
    "An older key for this document can't be reached from this device, so older history can't be checked.",
    AGAIN,
  ],
  [
    { reason: "rejected", run: 1, status: "unavailable" },
    "The server's response failed a signature or integrity check.",
    AGAIN,
  ],
  [
    { reason: "unsettled", run: 1, status: "unavailable" },
    "This device couldn't finish reading the history. Try again later.",
    AGAIN,
  ],
  [
    { reason: "too_large", run: 1, status: "unavailable" },
    "This history is too large to check on this device.",
    AGAIN,
  ],
  [
    { reason: "interrupted", run: 1, status: "unavailable" },
    "The check was interrupted.",
    AGAIN,
  ],
  [
    { reason: "capture_outdated", run: 1, status: "unavailable" },
    UNAVAILABLE.capture_outdated,
    AGAIN,
  ],
  [
    { message: "database is closed", run: 1, status: "failed" },
    "Couldn't check the history.",
    "Try again",
  ],
];

test.each(STATUSES)("%j says what the check found", (state, text, action) => {
  const view = mount(state);

  expect(view.status()?.textContent).toBe(text);
  // The action starts a check, from whatever the last one found.
  const button = view.button(action);
  expect(button?.hasAttribute("disabled")).toBe(false);
  if (button) fireEvent.click(button);
  expect(view.verify.count).toBe(1);
});

test("a running check says how far it has read, and cannot be asked for twice", () => {
  const checking: DocumentHistoryVerificationState = {
    captureVersion: [],
    progress: null,
    run: 1,
    status: "checking",
  };
  const view = mount(checking);
  expect(view.status()?.textContent).toBe("Checking the signed uploads...");

  view.unmount();
  const reading = mount({
    ...checking,
    progress: { updatesRead: 64, updatesTotal: 130 },
  });
  expect(reading.status()?.textContent).toBe("Checking 64 of 130 uploads...");
  const button = reading.button("Verify history");
  expect(button?.hasAttribute("disabled")).toBe(true);
  expect(button?.getAttribute("aria-busy")).toBe("true");
});

test("the check is asked about this device's capture, never automatically", () => {
  const view = mount();

  expect(view.captures.at(-1)).toBe(LOCAL);
  expect(view.verify.count).toBe(0);
});

test("a mismatch offers the signed history, and the way back", () => {
  const view = mount(MISMATCH);
  expect(view.button("Back to this device's copy")).toBeNull();

  const viewSigned = view.button("View signed history");
  if (!viewSigned) throw new Error("expected the signed history action");
  fireEvent.click(viewSigned);
  // The very replay the check brought is the one put on screen.
  expect(view.shownSigned).toEqual([SIGNED]);
  expect(view.status()?.textContent).toBe(
    "This is the history rebuilt from the signed uploads. This device's copy differs from it.",
  );
  // The check still belongs to the device's capture underneath.
  expect(view.captures.at(-1)).toBe(LOCAL);
  // No new check from here: it would close the replay on screen.
  expect(view.button("View signed history")).toBeNull();
  expect(view.button(AGAIN)).toBeNull();

  const back = view.button("Back to this device's copy");
  if (!back) throw new Error("expected the way back");
  fireEvent.click(back);
  expect(view.status()?.textContent).toBe(
    "This device's copy differs from the signed uploads.",
  );
  expect(view.button("View signed history")).not.toBeNull();
});

test("a signed history with no changes to show is not offered", () => {
  const view = mount({ ...MISMATCH, signed: { ...SIGNED, stops: [] } });

  expect(view.status()?.textContent).toBe(
    "This device's copy differs from the signed uploads.",
  );
  expect(view.button("View signed history")).toBeNull();
});

test("an unchecked history takes who and when from the server's attribution", () => {
  const view = mount();

  expect(view.shownTime()).toBe(
    formatMiniAppDateTimeSeconds(Date.parse(SERVER_STORED)),
  );
  expect(view.caption()).toContain("Uploaded by ada");
  // Nothing is said about signed uploads before a check.
  for (const label of Object.values(
    EXPLORER_LABELS.documentHistoryVerifyProvenance,
  )) {
    expect(view.caption()).not.toContain(label);
  }
});

test("a checked history takes who and when from the uploads verified here", () => {
  for (const state of [
    { report: report(), run: 1, status: "verified" },
    MISMATCH,
  ] satisfies DocumentHistoryVerificationState[]) {
    const view = mount(state);

    // The verified upload, not the one the server's attribution named.
    expect(view.shownTime()).toBe(
      formatMiniAppDateTimeSeconds(Date.parse(VERIFIED_STORED)),
    );
    expect(view.caption()).toContain("Uploaded by grace");
    expect(view.caption()).not.toContain("ada");
    expect(view.caption()).toContain("This change is in a signed upload.");
    view.unmount();
  }
});

test("a change says where the server's signed history holds it", () => {
  const baseline = mount({
    report: report({
      ranges: [
        upload({
          authorityKind: "baseline",
          createdAt: VERIFIED_STORED,
          writerUserId: "grace",
        }),
      ],
    }),
    run: 1,
    status: "verified",
  });
  expect(baseline.caption()).toContain(
    "This change is only in a key-rotation snapshot, as its signer asserted.",
  );
  // A snapshot re-asserts operations; it does not say who uploaded them.
  expect(baseline.caption()).not.toContain("Uploaded by");
  baseline.unmount();

  // An edit not uploaded yet, or one the server no longer holds: no range.
  const absent = mount({
    report: report({ ranges: [] }),
    run: 1,
    status: "verified",
  });
  expect(absent.caption()).toContain(
    "This change is not in the server's history.",
  );
  expect(absent.caption()).not.toContain("Uploaded by");
  // Its time is the device's own: no upload bounds it.
  expect(absent.shownTime()).toBe(formatMiniAppDateTimeSeconds(MADE_AT));
});

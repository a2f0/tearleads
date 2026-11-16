import { afterEach, expect, test } from "bun:test";
import type {
  DocumentHistoryView,
  DocumentMutationGuard,
  DocumentSnapshot,
  DocumentStore,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { act } from "react";
import {
  DocumentContext,
  DocumentReadOnlyContext,
  DocumentWriteScopeContext,
} from "../../../../stores/documents/DocumentsProvider";
import { EXPLORER_LABELS } from "../../labels";
import { DocumentHistoryRestore } from "./DocumentHistoryRestore";

afterEach(cleanup);

const VIEW: DocumentHistoryView = {
  attachments: [],
  documentKind: "note",
  fieldValidationIssues: [],
  rows: [],
  structuredFields: {},
  text: "an earlier version",
  title: "an earlier version",
};

const SNAPSHOT: DocumentSnapshot = {
  attachments: [],
  attachmentStatusBySlotId: {},
  attachmentStorageKeyBySlotId: {},
  canAttach: true,
  canWrite: true,
  currentAuthorId: "user-1",
  documentId: "remote-1",
  documentKind: "note",
  effectiveAccessLevel: "admin",
  fieldValidationIssues: [],
  ready: true,
  rows: [],
  structuredFields: {},
  syncing: false,
  text: "the current version",
  title: "the current version",
};

/** A live document whose restore stays queued until the test settles it. */
function liveDocument(snapshot: DocumentSnapshot = SNAPSHOT) {
  const calls: Array<{
    content: unknown;
    guard: DocumentMutationGuard | undefined;
    settle: (restored: boolean) => void;
  }> = [];
  const store = {
    getSnapshot: () => snapshot,
    restoreContent: (content: unknown, guard?: DocumentMutationGuard) =>
      new Promise<boolean>((settle) => {
        calls.push({ content, guard, settle });
      }),
    subscribe: () => () => undefined,
  } as unknown as DocumentStore;
  return { calls, store };
}

function mount(
  store: DocumentStore,
  options: { isLatest?: boolean; onRestored?: () => void } = {},
) {
  const scope = { current: {} as object };
  const element = (readOnly: boolean, index = 2) => (
    <DocumentContext.Provider value={store}>
      <DocumentWriteScopeContext.Provider value={scope.current}>
        <DocumentReadOnlyContext.Provider value={readOnly}>
          <DocumentHistoryRestore
            index={index}
            isLatest={options.isLatest ?? false}
            onRestored={options.onRestored ?? (() => undefined)}
            versionTime="Jan 1, 2030, 12:00:00 PM"
            view={VIEW}
          />
        </DocumentReadOnlyContext.Provider>
      </DocumentWriteScopeContext.Provider>
    </DocumentContext.Provider>
  );
  const view = render(element(false));
  return {
    ...view,
    /** Re-render, optionally read-only, at another stop, or under a new scope. */
    update: (
      next: { index?: number; newScope?: boolean; readOnly?: boolean } = {},
    ) => {
      if (next.newScope) scope.current = {};
      view.rerender(element(next.readOnly ?? false, next.index));
    },
  };
}

async function confirmRestore(view: ReturnType<typeof mount>) {
  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentHistoryRestoreAction,
    }),
  );
  fireEvent.click(
    await view.findByRole("button", {
      name: EXPLORER_LABELS.documentHistoryRestoreConfirm,
    }),
  );
}

test("a confirmed restore writes the version on screen and reports it", async () => {
  const live = liveDocument();
  let restored = 0;
  const view = mount(live.store, {
    onRestored: () => {
      restored += 1;
    },
  });

  await confirmRestore(view);
  expect(live.calls).toHaveLength(1);
  expect(live.calls[0]?.content).toBe(VIEW);
  expect(live.calls[0]?.guard?.stillCurrent?.()).toBe(true);
  expect(view.queryByRole("dialog")).toBeNull();

  await act(async () => live.calls[0]?.settle(true));
  expect(restored).toBe(1);
});

test("nothing is written until the restore is confirmed, and cancelling abandons it", async () => {
  const live = liveDocument();
  const view = mount(live.store);

  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentHistoryRestoreAction,
    }),
  );
  await view.findByRole("dialog", {
    name: EXPLORER_LABELS.documentHistoryRestoreTitle,
  });
  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentHistoryRestoreCancel,
    }),
  );

  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(live.calls).toHaveLength(0);
});

test("the restore is not offered on the newest stop or a document that cannot be written", () => {
  const newest = mount(liveDocument().store, { isLatest: true });
  expect(newest.queryByRole("button")).toBeNull();
  newest.unmount();

  const readOnly = mount(liveDocument({ ...SNAPSHOT, canWrite: false }).store);
  expect(readOnly.queryByRole("button")).toBeNull();
  readOnly.unmount();

  const loading = mount(liveDocument({ ...SNAPSHOT, ready: false }).store);
  expect(loading.queryByRole("button")).toBeNull();
});

test("a queued restore is refused once the document turns read-only", async () => {
  const live = liveDocument();
  const view = mount(live.store);
  await confirmRestore(view);
  const guard = live.calls[0]?.guard;
  expect(guard?.stillCurrent?.()).toBe(true);

  // The document is moved to the Trash while the write waits in the queue.
  // The control stops rendering but stays mounted, so only the guard stops it.
  view.update({ readOnly: true });

  expect(guard?.stillCurrent?.()).toBe(false);
});

test("a queued restore is refused once the write scope changes", async () => {
  const live = liveDocument();
  const view = mount(live.store);
  await confirmRestore(view);
  const guard = live.calls[0]?.guard;
  expect(guard?.stillCurrent?.()).toBe(true);

  // Another database, account, or key set: the confirmation was not for it.
  view.update({ newScope: true });

  expect(guard?.stillCurrent?.()).toBe(false);
});

test("a queued restore is refused once the control is gone", async () => {
  const live = liveDocument();
  const view = mount(live.store);
  await confirmRestore(view);
  const guard = live.calls[0]?.guard;

  view.unmount();

  expect(guard?.stillCurrent?.()).toBe(false);
});

test("a restore that did not persist is reported, and moving on clears it", async () => {
  const live = liveDocument();
  const view = mount(live.store);
  await confirmRestore(view);

  await act(async () => live.calls[0]?.settle(false));
  expect(
    view.getByText(EXPLORER_LABELS.documentHistoryRestoreRefused),
  ).toBeTruthy();

  view.update({ index: 1 });
  await waitFor(() =>
    expect(
      view.queryByText(EXPLORER_LABELS.documentHistoryRestoreRefused),
    ).toBeNull(),
  );
});

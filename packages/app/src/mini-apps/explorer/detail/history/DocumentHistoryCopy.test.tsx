import { afterEach, expect, test } from "bun:test";
import type {
  DocumentHistoryView,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { act } from "react";
import { EXPLORER_LABELS } from "../../labels";
import { DocumentHistoryCopy } from "./DocumentHistoryCopy";
import type { ExplorerDocumentVersionCopy } from "./useExplorerDocumentVersionCopy";

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

const DOCUMENT: DocumentSummary = {
  containerId: "folder-1",
  documentId: "remote-1",
  documentKind: "note",
  id: "local-1",
  title: "the current version",
  updatedAt: "2030-01-01T12:00:00.000Z",
};

const COPY: DocumentSummary = {
  containerId: "folder-1",
  documentId: null,
  documentKind: "note",
  id: "copy-1",
  title: "an earlier version",
  updatedAt: "2030-01-01T12:00:01.000Z",
};

/** A copy capability whose saves stay pending until the test settles them. */
function versionCopy() {
  const saves: Array<{
    content: unknown;
    document: DocumentSummary;
    fail: (error: unknown) => void;
    settle: (copy: DocumentSummary | null) => void;
  }> = [];
  const asked: Array<{ document: DocumentSummary; documentKind: string }> = [];
  const opened: DocumentSummary[] = [];
  const state = { offered: true };
  const copy: ExplorerDocumentVersionCopy = {
    canSave: (document, documentKind) => {
      asked.push({ document, documentKind });
      return state.offered;
    },
    open: (saved) => {
      opened.push(saved);
    },
    save: (document, content) =>
      new Promise<DocumentSummary | null>((settle, fail) => {
        saves.push({ content, document, fail, settle });
      }),
  };
  return { asked, copy, opened, saves, state };
}

function mount(
  capability: ReturnType<typeof versionCopy>,
  options: { onRequested?: () => void } = {},
) {
  const element = (index = 2) => (
    <DocumentHistoryCopy
      copy={capability.copy}
      documentSummary={DOCUMENT}
      index={index}
      onRequested={options.onRequested ?? (() => undefined)}
      versionTime="Jan 1, 2030, 12:00:00 PM"
      view={VIEW}
    />
  );
  const view = render(element());
  return {
    ...view,
    /** Re-render, optionally at another stop. */
    update: (next: { index?: number } = {}) =>
      view.rerender(element(next.index)),
  };
}

function copyButton(view: ReturnType<typeof mount>) {
  return view.getByRole("button", {
    name: EXPLORER_LABELS.documentHistoryCopyAction,
  });
}

async function confirmCopy(view: ReturnType<typeof mount>) {
  fireEvent.click(copyButton(view));
  fireEvent.click(
    await view.findByRole("button", {
      name: EXPLORER_LABELS.documentHistoryCopyConfirm,
    }),
  );
}

test("a confirmed copy saves the version on screen beside its document", async () => {
  const capability = versionCopy();
  const view = mount(capability);

  await confirmCopy(view);
  expect(capability.saves).toHaveLength(1);
  expect(capability.saves[0]?.document).toBe(DOCUMENT);
  expect(capability.saves[0]?.content).toBe(VIEW);
  expect(view.queryByRole("dialog")).toBeNull();
  // The folder is asked about the version's kind, not the document's.
  expect(capability.asked.at(-1)).toEqual({
    document: DOCUMENT,
    documentKind: "note",
  });

  await act(async () => capability.saves[0]?.settle(COPY));
  expect(view.getByText(EXPLORER_LABELS.documentHistoryCopySaved)).toBeTruthy();
});

test("a saved copy can be opened", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);
  await act(async () => capability.saves[0]?.settle(COPY));

  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentHistoryCopyOpenAction,
    }),
  );

  expect(capability.opened).toEqual([COPY]);
});

test("asking to copy tells the host to hold the timeline before confirming", async () => {
  const capability = versionCopy();
  const order: string[] = [];
  const view = mount(capability, { onRequested: () => order.push("held") });

  fireEvent.click(copyButton(view));
  await view.findByRole("dialog", {
    name: EXPLORER_LABELS.documentHistoryCopyTitle,
  });

  // During playback the next tick would otherwise move to another stop and
  // dismiss this confirmation.
  expect(order).toEqual(["held"]);
  expect(capability.saves).toHaveLength(0);
});

test("nothing is created until the copy is confirmed, and cancelling abandons it", async () => {
  const capability = versionCopy();
  const view = mount(capability);

  fireEvent.click(copyButton(view));
  await view.findByRole("dialog", {
    name: EXPLORER_LABELS.documentHistoryCopyTitle,
  });
  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentHistoryCopyCancel,
    }),
  );

  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(capability.saves).toHaveLength(0);
});

test("the confirmation says what is and is not copied", async () => {
  const capability = versionCopy();
  const view = mount(capability);

  fireEvent.click(copyButton(view));
  const dialog = await view.findByRole("dialog", {
    name: EXPLORER_LABELS.documentHistoryCopyTitle,
  });

  expect(dialog.textContent).toContain("Jan 1, 2030, 12:00:00 PM");
  expect(dialog.textContent).toContain("Attachments are not copied");
});

test("the confirmation takes focus, closes on Escape, and gives focus back", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  const trigger = copyButton(view);
  trigger.focus();
  fireEvent.click(trigger);

  const cancel = await view.findByRole("button", {
    name: EXPLORER_LABELS.documentHistoryCopyCancel,
  });
  // Focus starts on the safe choice, not on Save copy.
  expect(document.activeElement).toBe(cancel);

  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(capability.saves).toHaveLength(0);
});

test("the copy is not offered where the folder does not take it", () => {
  const capability = versionCopy();
  capability.state.offered = false;
  const view = mount(capability);

  expect(view.queryByRole("button")).toBeNull();
});

test("confirming twice creates one document", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  fireEvent.click(copyButton(view));
  const form = (
    await view.findByRole("dialog", {
      name: EXPLORER_LABELS.documentHistoryCopyTitle,
    })
  ).querySelector("form");
  if (!form) throw new Error("the confirmation has no form");

  // Two submits before React renders the dialog away.
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });

  expect(capability.saves).toHaveLength(1);
});

test("a copy in flight cannot be started again", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);

  fireEvent.click(copyButton(view));

  expect(view.queryByRole("dialog")).toBeNull();
  expect(capability.saves).toHaveLength(1);
});

test("a copy that was not created is reported, and moving on clears it", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);

  await act(async () => capability.saves[0]?.settle(null));
  expect(
    view.getByText(EXPLORER_LABELS.documentHistoryCopyRefused),
  ).toBeTruthy();

  view.update({ index: 1 });
  await waitFor(() =>
    expect(
      view.queryByText(EXPLORER_LABELS.documentHistoryCopyRefused),
    ).toBeNull(),
  );
});

test("a copy that failed is reported as not created", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);

  await act(async () => capability.saves[0]?.fail(new Error("no database")));

  expect(
    view.getByText(EXPLORER_LABELS.documentHistoryCopyRefused),
  ).toBeTruthy();
});

test("a saved copy stays reachable when the folder stops taking documents", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);

  // The folder is trashed while the copy is being created.
  capability.state.offered = false;
  view.update();
  await act(async () => capability.saves[0]?.settle(COPY));

  expect(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentHistoryCopyOpenAction,
    }),
  ).toBeTruthy();
  // No further copy is offered there.
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.documentHistoryCopyAction,
    }),
  ).toBeNull();
});

test("a copy finishing after the control is gone reports nothing", async () => {
  const capability = versionCopy();
  const view = mount(capability);
  await confirmCopy(view);

  view.unmount();

  // Settling must not throw or update an unmounted control.
  await act(async () => capability.saves[0]?.settle(COPY));
  expect(capability.opened).toHaveLength(0);
});

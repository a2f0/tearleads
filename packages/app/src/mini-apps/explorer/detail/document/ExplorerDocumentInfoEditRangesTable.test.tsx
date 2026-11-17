import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { createElement } from "react";
import {
  getFoldedSecondaryTexts,
  mockPhoneRoutedLayout,
} from "../../../../../test/helpers/compactTableFold";
import { readKeyValueRows } from "../../../../../test/helpers/keyValueRows";
import { EXPLORER_LABELS } from "../../labels";
import { compactId } from "../compactId";
import { EditRangesTable } from "./ExplorerDocumentInfoEditRangesTable";

let restoreLayout: () => void = () => undefined;

beforeEach(() => {
  restoreLayout = mockPhoneRoutedLayout();
});

afterEach(() => {
  cleanup();
  restoreLayout();
});

test("folded edit ranges keep the writer over peer, range, ops, upload, and authority", () => {
  const view = render(
    createElement(EditRangesTable, {
      attributionUserLabelResolver: (userId) =>
        userId === "writer-1" ? "Countess" : null,
      items: [
        {
          authorityKind: "direct",
          endCounter: 5,
          peerId: "peer-1",
          startCounter: 2,
          updateId: "update-aaaa",
          writerKeyFingerprint: "fingerprint-1",
          writerUserId: "writer-1",
        },
      ],
    }),
  );
  const table = view.getByRole("table", {
    name: EXPLORER_LABELS.documentInfoEditRangesHeading,
  });

  expect(table.querySelectorAll("thead th")).toHaveLength(1);
  expect(within(table).getByText("Countess")).toBeTruthy();
  expect(getFoldedSecondaryTexts(table)).toEqual([
    [
      `${EXPLORER_LABELS.documentInfoEditRangePeerColumn}: ${compactId("peer-1")}`,
      `${EXPLORER_LABELS.documentInfoEditRangeRangeColumn}: 2–5`,
      `${EXPLORER_LABELS.documentInfoEditRangeOpsColumn}: 3`,
      `${EXPLORER_LABELS.documentInfoEditRangeUploadColumn}: ${compactId("update-aaaa")}`,
      `${EXPLORER_LABELS.documentInfoEditRangeAuthorityColumn}: ${EXPLORER_LABELS.documentInfoEditRangeAuthorityDirect}`,
    ],
  ]);
});

// Ids long enough that the folded row has to shorten them.
const PEER_ID = "peer-0123456789-abcdefghij";
const UPDATE_ID = "update-0123456789-abcdefghij";
const WRITER_KEY = "fingerprint-0123456789-abcdefghij";
const EDIT_RANGE = {
  authorityKind: "baseline",
  endCounter: 9,
  peerId: PEER_ID,
  startCounter: 4,
  updateId: UPDATE_ID,
  writerKeyFingerprint: WRITER_KEY,
  writerUserId: "writer-1",
} as const;

function renderEditRanges(
  items: ReadonlyArray<typeof EDIT_RANGE> = [EDIT_RANGE],
) {
  return createElement(EditRangesTable, {
    attributionUserLabelResolver: (userId) =>
      userId === "writer-1" ? "Countess" : null,
    items: [...items],
  });
}

function getFirstBodyRow(table: HTMLElement): HTMLElement {
  const row = table.querySelector<HTMLElement>("tbody tr");
  if (!row) {
    throw new Error("No body row");
  }
  return row;
}

test("a folded edit range opens its peer, upload, and writer ids whole", () => {
  const view = render(renderEditRanges());
  const table = view.getByRole("table", {
    name: EXPLORER_LABELS.documentInfoEditRangesHeading,
  });
  expect(table.textContent).not.toContain(UPDATE_ID);

  fireEvent.click(getFirstBodyRow(table));

  const dialog = view.getByRole("dialog", {
    name: EXPLORER_LABELS.infoRowDetailEditRangeTitle,
  });
  expect(readKeyValueRows(dialog)).toEqual({
    [EXPLORER_LABELS.documentInfoEditRangeWriterColumn]: "Countess",
    [EXPLORER_LABELS.infoRowDetailWriterUserIdRow]: "writer-1",
    [EXPLORER_LABELS.infoRowDetailWriterKeyRow]: WRITER_KEY,
    [EXPLORER_LABELS.documentInfoEditRangePeerColumn]: PEER_ID,
    [EXPLORER_LABELS.documentInfoEditRangeRangeColumn]: "4–9",
    [EXPLORER_LABELS.documentInfoEditRangeOpsColumn]: "5",
    [EXPLORER_LABELS.documentInfoEditRangeUploadColumn]: UPDATE_ID,
    [EXPLORER_LABELS.documentInfoEditRangeAuthorityColumn]:
      EXPLORER_LABELS.documentInfoEditRangeAuthorityReasserted,
  });
});

test("the detail closes with a row that is no longer listed", () => {
  const view = render(renderEditRanges());
  fireEvent.click(view.getByRole("button", { name: "Countess" }));
  expect(view.getByRole("dialog")).toBeTruthy();

  view.rerender(renderEditRanges([]));
  expect(view.queryByRole("dialog")).toBeNull();

  // Listed again, it stays closed until it is opened again.
  view.rerender(renderEditRanges());
  expect(view.queryByRole("dialog")).toBeNull();
});

test("a click that ends a text selection does not open the detail", () => {
  const view = render(renderEditRanges());
  const table = view.getByRole("table", {
    name: EXPLORER_LABELS.documentInfoEditRangesHeading,
  });
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(getFirstBodyRow(table));
  selection?.removeAllRanges();
  selection?.addRange(range);
  try {
    fireEvent.click(getFirstBodyRow(table));
    expect(view.queryByRole("dialog")).toBeNull();

    // The button is an explicit activation, whatever is selected.
    fireEvent.click(view.getByRole("button", { name: "Countess" }));
    expect(view.getByRole("dialog")).toBeTruthy();
  } finally {
    selection?.removeAllRanges();
  }
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { createElement } from "react";
import {
  getFoldedSecondaryTexts,
  mockPhoneRoutedLayout,
} from "../../../../../test/helpers/compactTableFold";
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

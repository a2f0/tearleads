import { afterEach, expect, test } from "bun:test";
import type { ContainerInfo } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { createElement } from "react";
import { mockPhoneRoutedLayout } from "../../../../../test/helpers/compactTableFold";
import { readKeyValueRows } from "../../../../../test/helpers/keyValueRows";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
import {
  ExplorerContainerInfoSecuritySection,
  ExplorerContainerInfoSyncCursorsSection,
} from "../container/ExplorerContainerInfoSecuritySyncSections";

// Ids long enough that a row has to shorten them: the detail must not.
const CONTAINER_ID = "container-0123456789-abcdefghij";
const MANIFEST_HASH = "manifest-hash-0123456789-abcdefghij";
const EVENT_HASH = "event-hash-0123456789-abcdefghij";
const KEY_EPOCH_ID = "key-epoch-0123456789-abcdefghij";
const WATERMARK_ID = "watermark-0123456789-abcdefghij";
const WATERMARK_UPDATED_AT = "2026-05-18T12:01:00.000Z";
const SAVED_AT = "2026-05-18T12:00:00.000Z";

const REMOTE_INFO: NonNullable<ContainerInfo["remoteInfo"]> = {
  grantRows: [],
  grants: [],
  groups: [],
  security: {
    currentContainerKeyEpoch: 3,
    currentContainerKeyEpochId: KEY_EPOCH_ID,
    currentManifestHash: MANIFEST_HASH,
    currentManifestHistoryCount: 2,
    currentParentContainerKeyEpochId: null,
    currentReferencedPrincipalCount: 2,
    path: [
      {
        containerId: CONTAINER_ID,
        containerKeyEpoch: 3,
        containerKeyEpochId: KEY_EPOCH_ID,
        directGrantCount: 1,
        eventHash: EVENT_HASH,
        keyEpochHash: "key-epoch-hash-1",
        keyTargetHash: "key-target-hash-1",
        manifestHash: MANIFEST_HASH,
        manifestHistoryCount: 2,
        parentContainerId: null,
        parentManifestHash: null,
        recipientTargetCount: 1,
        referencedPrincipalCount: 2,
        wrapCount: 0,
      },
    ],
    pathLength: 1,
  },
  syncCursors: [
    {
      label: "Container contents",
      laneId: CONTAINER_ID,
      laneKind: "container-contents",
      savedAt: SAVED_AT,
      watermarkId: WATERMARK_ID,
      watermarkUpdatedAt: WATERMARK_UPDATED_AT,
    },
    {
      label: "Container documents",
      laneId: CONTAINER_ID,
      laneKind: "container-documents",
      savedAt: null,
      watermarkId: null,
      watermarkUpdatedAt: null,
    },
  ],
};

let restoreLayout: () => void = () => undefined;

afterEach(() => {
  cleanup();
  restoreLayout();
  restoreLayout = () => undefined;
});

function renderSecurity() {
  return render(
    createElement(ExplorerContainerInfoSecuritySection, {
      containerNamesById: new Map([[CONTAINER_ID, "Field Notes"]]),
      remoteInfo: REMOTE_INFO,
    }),
  );
}

function renderSyncCursors() {
  return render(
    createElement(ExplorerContainerInfoSyncCursorsSection, {
      remoteInfo: REMOTE_INFO,
    }),
  );
}

function getBodyRow(table: HTMLElement, index: number): HTMLElement {
  const row = table.querySelectorAll<HTMLElement>("tbody tr")[index];
  if (!row) {
    throw new Error(`No body row ${index}`);
  }
  return row;
}

test("a folded path row opens every value the wide columns hold, ids whole", () => {
  restoreLayout = mockPhoneRoutedLayout();
  const view = renderSecurity();
  const table = view.getByRole("table", {
    name: EXPLORER_LABELS.containerInfoPathHeading,
  });
  expect(table.querySelectorAll("thead th")).toHaveLength(1);
  // The folded row shortens the ids it has room for.
  expect(table.textContent).not.toContain(MANIFEST_HASH);
  expect(view.queryByRole("dialog")).toBeNull();

  // Anywhere on the row, not only its button.
  fireEvent.click(getBodyRow(table, 0));

  const dialog = view.getByRole("dialog", {
    name: EXPLORER_LABELS.infoRowDetailPathEntryTitle,
  });
  expect(readKeyValueRows(dialog)).toEqual({
    [EXPLORER_LABELS.infoRowDetailContainerRow]: "Field Notes",
    [EXPLORER_LABELS.infoRowDetailContainerIdRow]: CONTAINER_ID,
    [EXPLORER_LABELS.infoRowDetailManifestHashRow]: MANIFEST_HASH,
    [EXPLORER_LABELS.infoRowDetailEventHashRow]: EVENT_HASH,
    [EXPLORER_LABELS.containerInfoSecurityKeyEpochRow]: "3",
    [EXPLORER_LABELS.infoRowDetailKeyEpochIdRow]: KEY_EPOCH_ID,
    [EXPLORER_LABELS.containerInfoRecipientsColumn]: "1 target, 0 wraps",
    [EXPLORER_LABELS.infoRowDetailGrantsRow]: "1 grant, 2 principals",
  });
  expect(
    within(dialog).getByRole("button", {
      name: `Copy ${EXPLORER_LABELS.infoRowDetailManifestHashRow}`,
    }),
  ).toBeTruthy();

  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(view.queryByRole("dialog")).toBeNull();
});

test("a folded sync cursor row opens its watermark id and exact times", () => {
  restoreLayout = mockPhoneRoutedLayout();
  const view = renderSyncCursors();
  const table = view.getByRole("table", {
    name: EXPLORER_LABELS.containerInfoSyncCursorsHeading,
  });
  expect(table.textContent).not.toContain(WATERMARK_ID);

  // The row's button is what a keyboard or screen reader activates.
  fireEvent.click(
    within(table).getByRole("button", { name: "Container contents" }),
  );

  const dialog = view.getByRole("dialog", {
    name: EXPLORER_LABELS.infoRowDetailSyncCursorTitle,
  });
  expect(readKeyValueRows(dialog)).toEqual({
    [EXPLORER_LABELS.containerInfoLaneColumn]: "Container contents",
    [EXPLORER_LABELS.infoRowDetailLaneIdRow]: `container-contents/${CONTAINER_ID}`,
    [EXPLORER_LABELS.containerInfoCursorColumn]: `${formatMiniAppDateTime(WATERMARK_UPDATED_AT)} (${WATERMARK_UPDATED_AT})`,
    [EXPLORER_LABELS.infoRowDetailWatermarkIdRow]: WATERMARK_ID,
    [EXPLORER_LABELS.containerInfoSavedColumn]: `${formatMiniAppDateTime(SAVED_AT)} (${SAVED_AT})`,
  });

  fireEvent.keyDown(document, { key: "Escape" });
  expect(view.queryByRole("dialog")).toBeNull();
});

test("a lane with no local cursor says so in its detail", () => {
  restoreLayout = mockPhoneRoutedLayout();
  const view = renderSyncCursors();
  const table = view.getByRole("table", {
    name: EXPLORER_LABELS.containerInfoSyncCursorsHeading,
  });

  fireEvent.click(getBodyRow(table, 1));

  expect(readKeyValueRows(view.getByRole("dialog"))).toEqual({
    [EXPLORER_LABELS.containerInfoLaneColumn]: "Container documents",
    [EXPLORER_LABELS.infoRowDetailLaneIdRow]: `container-documents/${CONTAINER_ID}`,
    [EXPLORER_LABELS.containerInfoCursorColumn]:
      EXPLORER_LABELS.containerInfoNoLocalCursor,
    [EXPLORER_LABELS.infoRowDetailWatermarkIdRow]: "-",
    [EXPLORER_LABELS.containerInfoSavedColumn]: "-",
  });
});

test("wide rows open the same detail", () => {
  const view = renderSecurity();
  const table = view.getByRole("table", {
    name: EXPLORER_LABELS.containerInfoPathHeading,
  });
  expect(table.querySelectorAll("thead th").length).toBeGreaterThan(1);

  fireEvent.click(within(table).getByRole("button", { name: "Field Notes" }));

  expect(
    readKeyValueRows(view.getByRole("dialog"))[
      EXPLORER_LABELS.infoRowDetailEventHashRow
    ],
  ).toBe(EVENT_HASH);
});

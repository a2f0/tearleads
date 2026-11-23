import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  SyncStatusPopoverBody,
  type SyncStatusViewRequest,
} from "./SyncStatusPopoverBody";
import type { SyncStatusResult } from "./useSyncStatus";

afterEach(cleanup);

const SYNCED: SyncStatusResult = {
  billingBlock: null,
  lanes: { failed: 0, firstError: null, running: 0 },
  pausedOrganizationCount: 0,
  pendingWriteCount: 0,
  queueReadFailed: false,
  status: "synced",
  title: "All changes synced",
};

function renderBody(
  overrides: Partial<Parameters<typeof SyncStatusPopoverBody>[0]> = {},
) {
  const handlers = {
    onClose: mock(() => {}),
    onOpenView: mock((_request: SyncStatusViewRequest) => {}),
    onSyncNow: mock(() => {}),
  };
  const view = render(
    <SyncStatusPopoverBody
      canSync
      downloads={{ failed: 0, firstError: null, pending: 0, status: "read" }}
      sync={SYNCED}
      uploadingFileCount={0}
      {...handlers}
      {...overrides}
    />,
  );
  return { ...handlers, view };
}

test("Sync now requests sync and closes the popover", () => {
  const { onClose, onOpenView, onSyncNow, view } = renderBody();
  fireEvent.click(view.getByRole("button", { name: "Sync now" }));
  expect(onSyncNow).toHaveBeenCalledTimes(1);
  expect(onOpenView).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("each view link opens the path its destination writes", () => {
  const { onClose, onOpenView, view } = renderBody({
    downloads: { failed: 1, firstError: "x", pending: 2, status: "read" },
    sync: {
      ...SYNCED,
      lanes: { failed: 1, firstError: "x", running: 0 },
      pendingWriteCount: 1,
      status: "error",
    },
    uploadingFileCount: 1,
  });
  for (const name of [
    "View write queue",
    "View downloads",
    "View uploads",
    "View sync lanes",
  ])
    fireEvent.click(view.getByRole("button", { name }));
  expect(onOpenView.mock.calls).toEqual([
    [{ appId: "explorer", pathSegments: ["outgoing", "writes"] }],
    [{ appId: "explorer", pathSegments: ["incoming"] }],
    [{ appId: "explorer", pathSegments: ["outgoing", "uploads"] }],
    [{ appId: "explorer", pathSegments: ["sync"] }],
  ]);
  expect(onClose).toHaveBeenCalledTimes(4);
});

test("Sync now is not offered when sync cannot run, and billing links instead", () => {
  const offline = renderBody({ canSync: false });
  expect(offline.view.queryByRole("button", { name: "Sync now" })).toBeNull();
  cleanup();

  const billing = renderBody({
    sync: { ...SYNCED, billingBlock: "active", status: "billing" },
  });
  expect(billing.view.queryByRole("button", { name: "Sync now" })).toBeNull();
  fireEvent.click(billing.view.getByRole("button", { name: "Update billing" }));
  expect(billing.onOpenView).toHaveBeenCalledWith({
    appId: "org-manager",
    pathSegments: ["billing"],
  });
  cleanup();

  // Another organization's lapse blocks only its own sync, so the rest can
  // still be synced now.
  const other = renderBody({
    sync: { ...SYNCED, billingBlock: "other", status: "billing" },
  });
  expect(other.view.getByRole("button", { name: "Sync now" })).toBeTruthy();
  expect(
    other.view.getByRole("button", { name: "Update billing" }),
  ).toBeTruthy();
});

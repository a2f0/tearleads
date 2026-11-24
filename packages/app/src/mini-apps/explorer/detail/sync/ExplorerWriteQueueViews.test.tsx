import { afterEach, expect, test } from "bun:test";
import {
  createDomainScope,
  getDomainSyncCoordinatorSnapshot,
} from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import {
  ARCHIVE_NODE,
  CREATED_AT,
  item,
  operation,
} from "../../../../../test/helpers/explorer/syncPanelFixtures";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerWriteQueueEntryView } from "./ExplorerWriteQueueViews";

afterEach(cleanup);

type EntryViewProps = ComponentProps<typeof ExplorerWriteQueueEntryView>;

function renderEntry(overrides: Partial<EntryViewProps> = {}) {
  const props: EntryViewProps = {
    billingBlockedOrganizationId: null,
    error: null,
    isAuthenticated: true,
    items: [],
    loading: false,
    nodes: [ARCHIVE_NODE],
    online: true,
    organizationNamesById: new Map([["personal-org", "Personal"]]),
    selectedEntryKey: "document::document-local-id",
    snapshot: getDomainSyncCoordinatorSnapshot(createDomainScope()),
    ...overrides,
  };
  return render(<ExplorerWriteQueueEntryView {...props} />);
}

test("explains why an errored entry is stuck in its detail view", () => {
  const view = renderEntry({
    items: [
      item({
        operations: [
          operation({
            kind: "update",
            lastAttemptedAt: CREATED_AT,
            lastError: "Manifest write rejected",
          }),
        ],
        status: "error",
      }),
    ],
  });

  expect(
    view.getByText(EXPLORER_LABELS.writeQueueEntryReasonHeading),
  ).toBeTruthy();
  expect(
    view.getByText(
      `${EXPLORER_LABELS.writeQueueEntryReasonErrorPrefix} Manifest write rejected`,
    ),
  ).toBeTruthy();
  expect(
    view.getByText(EXPLORER_LABELS.writeQueueEntryOperationsHeading),
  ).toBeTruthy();
  // The General section names the entry; no header repeats it.
  expect(view.container.querySelector(".mini-app-header")).toBeNull();
  expect(view.getAllByText("Offline note").length).toBeGreaterThan(0);
});

test("reports an entry that has left the queue", () => {
  const view = renderEntry();

  expect(view.getByText(EXPLORER_LABELS.writeQueueEntryNotQueued)).toBeTruthy();
});

test("waits for the entry while the queue first loads", () => {
  const view = renderEntry({ loading: true });

  expect(view.getByText(EXPLORER_LABELS.writeQueueLoading)).toBeTruthy();
  expect(view.queryByText(EXPLORER_LABELS.writeQueueEntryNotQueued)).toBeNull();
});

test("surfaces a read failure instead of claiming the entry finished", () => {
  const view = renderEntry({ error: "Local database schema is obsolete" });

  expect(view.getByText(EXPLORER_LABELS.writeQueueFailedToLoad)).toBeTruthy();
  expect(view.getByRole("alert")).toBeTruthy();
  expect(view.queryByText(EXPLORER_LABELS.writeQueueEntryNotQueued)).toBeNull();
});

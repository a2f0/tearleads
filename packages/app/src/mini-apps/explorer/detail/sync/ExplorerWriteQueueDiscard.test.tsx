import { afterEach, expect, test } from "bun:test";
import type {
  PendingWriteQueueItem,
  PendingWriteQueueOperation,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerWriteQueuePanelView } from "./ExplorerWriteQueuePanel";

afterEach(cleanup);

const CREATED_AT = "2026-07-16T12:00:00.000Z";

const OPERATION: PendingWriteQueueOperation = {
  byteLength: 0,
  count: 1,
  createdAt: CREATED_AT,
  kind: "update",
  lastAttemptedAt: null,
  lastError: null,
  status: "pending",
  targetContainerId: null,
  updatedAt: CREATED_AT,
};

const ITEM: PendingWriteQueueItem = {
  containerId: "documents-container",
  createdAt: CREATED_AT,
  localId: "document-local-id",
  name: "Offline note",
  namespace: null,
  objectKind: "document",
  operations: [OPERATION],
  organizationId: "personal-org",
  remoteId: "document-remote-id",
  status: "pending",
  updatedAt: CREATED_AT,
};

const KEBAB_NAME = `${EXPLORER_LABELS.itemActionsButtonPrefix} Offline note`;

function renderQueue(
  discardPendingWrite?: (item: PendingWriteQueueItem) => Promise<boolean>,
) {
  return render(
    <ExplorerWriteQueuePanelView
      billingBlockedOrganizationId={null}
      discardPendingWrite={discardPendingWrite}
      error={false}
      isAuthenticated={true}
      items={[ITEM]}
      loading={false}
      nodes={[]}
      online={true}
      openContainerInfoRoute={() => undefined}
      openDocumentInfoRoute={() => undefined}
      organizationNamesById={new Map([["personal-org", "Personal"]])}
    />,
  );
}

test("renders no row actions kebab without a discard handler", () => {
  const view = renderQueue();
  expect(view.queryByRole("button", { name: KEBAB_NAME })).toBeNull();
});

test("discards a queued write only after an explicit confirm", async () => {
  const discarded: PendingWriteQueueItem[] = [];
  const view = renderQueue(async (queueItem) => {
    discarded.push(queueItem);
    return true;
  });

  fireEvent.click(view.getByRole("button", { name: KEBAB_NAME }));
  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.writeQueueDiscardAction,
    }),
  );
  // The first click only arms the confirm step; nothing is discarded yet.
  expect(discarded).toHaveLength(0);

  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.writeQueueDiscardConfirm,
    }),
  );
  await waitFor(() => expect(discarded).toHaveLength(1));
  expect(discarded[0]?.localId).toBe("document-local-id");
});

test("cancelling the discard confirm leaves the queue untouched", async () => {
  let discardCalls = 0;
  const view = renderQueue(async () => {
    discardCalls += 1;
    return true;
  });

  fireEvent.click(view.getByRole("button", { name: KEBAB_NAME }));
  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.writeQueueDiscardAction,
    }),
  );
  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.writeQueueDiscardCancel,
    }),
  );
  await waitFor(() =>
    expect(
      view.queryByRole("button", {
        name: EXPLORER_LABELS.writeQueueDiscardConfirm,
      }),
    ).toBeNull(),
  );
  expect(discardCalls).toBe(0);
});

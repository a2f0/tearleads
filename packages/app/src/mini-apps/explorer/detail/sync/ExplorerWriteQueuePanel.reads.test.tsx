import { afterEach, expect, test } from "bun:test";
import type {
  ContainerDocumentQueries,
  ContainerNode,
  PendingWriteQueueItem,
} from "@symcrypt/client-sdk";
import {
  createDomainScope,
  syncedContainerDocumentObjectSyncState,
} from "@symcrypt/client-sdk";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerWriteQueuePanel } from "./ExplorerWriteQueuePanel";

afterEach(() => cleanup());

const CREATED_AT = "2026-07-16T12:00:00.000Z";

const ARCHIVE_NODE = {
  id: "archive-container",
  kind: "container",
  name: "Archive",
  organizationId: "custom-org",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
} satisfies ContainerNode;

function item(): PendingWriteQueueItem {
  return {
    containerId: "documents-container",
    createdAt: CREATED_AT,
    localId: "document-local-id",
    name: "Offline note",
    namespace: null,
    objectKind: "document",
    operations: [
      {
        byteLength: 0,
        count: 1,
        createdAt: CREATED_AT,
        kind: "update",
        lastAttemptedAt: null,
        lastError: null,
        status: "pending",
        targetContainerId: null,
        updatedAt: CREATED_AT,
      },
    ],
    organizationId: "personal-org",
    remoteId: "document-remote-id",
    status: "pending",
    updatedAt: CREATED_AT,
  };
}

test("coalesces a revision-bump burst and keeps stale rows while re-reading", async () => {
  let queryCount = 0;
  const resolvers: Array<
    (items: ReadonlyArray<PendingWriteQueueItem>) => void
  > = [];
  const documentQueries = {
    listPendingWrites: () => {
      queryCount += 1;
      return new Promise<ReadonlyArray<PendingWriteQueueItem>>((resolve) => {
        resolvers.push(resolve);
      });
    },
  } as unknown as ContainerDocumentQueries;
  const domainScope = createDomainScope();
  const panelWithRevision = (documentListRevision: number) => (
    <ExplorerWriteQueuePanel
      billingBlockedOrganizationId={null}
      documentListRevision={documentListRevision}
      documentQueries={documentQueries}
      domainScope={domainScope}
      isAuthenticated={true}
      nodes={[ARCHIVE_NODE]}
      online={true}
      openContainerInfoRoute={() => undefined}
      openDocument={() => undefined}
      openWriteQueueEntryRoute={() => undefined}
      organizationNamesById={new Map()}
      selectedEntryKey={null}
    />
  );

  const view = render(panelWithRevision(0));
  expect(queryCount).toBe(1);

  // A burst of revision bumps while the first scan is still pending must queue
  // exactly one re-read, not one heavy scan per bump.
  view.rerender(panelWithRevision(1));
  view.rerender(panelWithRevision(2));
  view.rerender(panelWithRevision(3));
  expect(queryCount).toBe(1);

  await act(async () => {
    resolvers[0]?.([item()]);
  });

  // The stale first result stays on screen while the queued re-read runs; the
  // panel must not flip back to its loading state.
  expect(
    view.getByRole("button", { name: "Open object: Offline note" }),
  ).toBeTruthy();
  expect(view.queryByText(EXPLORER_LABELS.writeQueueLoading)).toBeNull();

  await waitFor(() => expect(queryCount).toBe(2));
  await act(async () => {
    resolvers[1]?.([]);
  });

  await waitFor(() =>
    expect(view.getByText(EXPLORER_LABELS.writeQueueEmpty)).toBeTruthy(),
  );
  expect(queryCount).toBe(2);
});

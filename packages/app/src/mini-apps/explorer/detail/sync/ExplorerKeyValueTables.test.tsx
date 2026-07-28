import { afterEach, expect, test } from "bun:test";
import type {
  DomainSyncSnapshot,
  PendingWriteQueueItem,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ExplorerSyncLaneDetail } from "./ExplorerSyncLaneDetail";
import { ExplorerWriteQueueEntryDetail } from "./ExplorerWriteQueueEntryDetail";

afterEach(() => cleanup());

const UPDATED_AT = "2026-07-28T10:00:00.000Z";

const SNAPSHOT: DomainSyncSnapshot = {
  hasPendingWork: true,
  lanes: [
    {
      blobStorageKey: null,
      errorCount: 0,
      key: "documents:local-1",
      label: "Document local-1",
      lastAction: "requested",
      lastActionAt: UPDATED_AT,
      lastCompletedAt: null,
      lastError: null,
      lastFailedAt: null,
      lastRequestedAt: UPDATED_AT,
      lastStartedAt: null,
      phase: "document",
      progress: null,
      registrationIndex: 1,
      requestCount: 1,
      requested: true,
      runCount: 0,
      running: false,
      status: "queued",
    },
  ],
  pumpActive: false,
  updatedAt: UPDATED_AT,
};

const QUEUE_ITEM: PendingWriteQueueItem = {
  containerId: "documents-container",
  createdAt: UPDATED_AT,
  localId: "local-1",
  name: "Offline note",
  namespace: null,
  objectKind: "document",
  operations: [
    {
      byteLength: 0,
      count: 2,
      createdAt: UPDATED_AT,
      kind: "update",
      lastAttemptedAt: null,
      lastError: null,
      status: "pending",
      targetContainerId: null,
      updatedAt: UPDATED_AT,
    },
  ],
  organizationId: "personal-org",
  remoteId: "remote-1",
  status: "pending",
  updatedAt: UPDATED_AT,
};

function expectAlignedBorderlessTables(container: HTMLElement, count: number) {
  const tables = Array.from(container.querySelectorAll("table"));
  expect(tables).toHaveLength(count);
  for (const table of tables) {
    expect(table.classList.contains("mini-app-info-table--aligned")).toBe(true);
    expect(table.classList.contains("mini-app-info-table--borderless")).toBe(
      true,
    );
  }
}

test("write queue detail tables share borderless key/value geometry", () => {
  const view = render(
    <ExplorerWriteQueueEntryDetail
      billingBlockedOrganizationId={null}
      containerNamesById={new Map()}
      isAuthenticated
      item={QUEUE_ITEM}
      online
      organizationNamesById={new Map()}
      snapshot={SNAPSHOT}
    />,
  );

  expectAlignedBorderlessTables(view.container, 2);
});

test("sync lane detail tabs share borderless key/value geometry", () => {
  const view = render(
    <ExplorerSyncLaneDetail laneKey="documents:local-1" snapshot={SNAPSHOT} />,
  );

  expectAlignedBorderlessTables(view.container, 1);
  for (const tabName of ["Timing", "Coordinator"]) {
    fireEvent.click(view.getByRole("tab", { name: tabName }));
    expectAlignedBorderlessTables(view.container, 1);
  }
});

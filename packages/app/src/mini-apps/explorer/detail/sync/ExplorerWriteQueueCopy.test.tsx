import { afterEach, expect, test } from "bun:test";
import {
  createDomainScope,
  getDomainSyncCoordinatorSnapshot,
  type PendingWriteQueueItem,
} from "@tearleads/client-sdk";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  ARCHIVE_NODE,
  CREATED_AT,
  item,
  operation,
} from "../../../../../test/helpers/explorer/syncPanelFixtures";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerWriteQueuePanelView } from "./ExplorerWriteQueuePanel";

// The row menu's Copy action: what lands on the clipboard for a bug report.

const ATTEMPTED_AT = "2026-07-16T12:05:00.000Z";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "clipboard",
);

afterEach(() => {
  cleanup();
  if (originalClipboardDescriptor) {
    Object.defineProperty(
      Navigator.prototype,
      "clipboard",
      originalClipboardDescriptor,
    );
  } else {
    Reflect.deleteProperty(Navigator.prototype, "clipboard");
  }
});

function installClipboard(): string[] {
  const written: string[] = [];
  Object.defineProperty(Navigator.prototype, "clipboard", {
    configurable: true,
    get: () => ({
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      },
    }),
  });
  return written;
}

async function copyEntry(
  queueItem: PendingWriteQueueItem,
  billingBlockedOrganizationId: string | null = null,
): Promise<string[]> {
  const written = installClipboard();
  const view = render(
    <ExplorerWriteQueuePanelView
      billingBlockedOrganizationId={billingBlockedOrganizationId}
      discardPendingWrites={() => undefined}
      error={null}
      isAuthenticated
      items={[queueItem]}
      loading={false}
      nodes={[ARCHIVE_NODE]}
      online
      openContainerInfoRoute={() => undefined}
      openDocument={() => undefined}
      openWriteQueueEntryRoute={() => undefined}
      organizationNamesById={
        new Map([
          ["custom-org", "Acme"],
          ["personal-org", "Personal"],
        ])
      }
      retryPendingWrites={() => undefined}
      selectedEntryKey={null}
      snapshot={getDomainSyncCoordinatorSnapshot(createDomainScope())}
    />,
  );
  fireEvent.click(
    view.getByRole("button", {
      name: `${EXPLORER_LABELS.writeQueueRowActionsLabel}: ${queueItem.name}`,
    }),
  );
  // The write settles asynchronously and then marks the row as copied.
  await act(async () => {
    fireEvent.click(
      view.getByRole("button", { name: EXPLORER_LABELS.writeQueueCopyAction }),
    );
    await Promise.resolve();
  });
  // Choosing the action closes the menu.
  expect(
    view.queryByRole("button", { name: EXPLORER_LABELS.writeQueueCopyAction }),
  ).toBeNull();
  return written;
}

test("copies a failed entry's ids and errors without any names", async () => {
  const written = await copyEntry(
    item({
      name: "Projects",
      operations: [
        operation({ kind: "create" }),
        operation({
          count: 2,
          kind: "update",
          lastAttemptedAt: ATTEMPTED_AT,
          lastError: "Metadata write failed",
        }),
        operation({
          kind: "move",
          status: "blocked",
          targetContainerId: ARCHIVE_NODE.id,
        }),
      ],
      organizationId: "custom-org",
      status: "error",
    }),
  );

  expect(written).toEqual([
    [
      "Write Queue Entry",
      "Object Kind: document",
      "Local ID: document-local-id",
      "Remote ID: document-remote-id",
      "Container ID: documents-container",
      "Organization ID: custom-org",
      "Status: error",
      `Created: ${CREATED_AT}`,
      `Updated: ${CREATED_AT}`,
      "Operations:",
      "- create x1: pending",
      "- update x2: pending",
      "  Last Error: Metadata write failed",
      `  Last Attempted: ${ATTEMPTED_AT}`,
      "- move x1: blocked",
      `  Target Container ID: ${ARCHIVE_NODE.id}`,
    ].join("\n"),
  ]);
  // The organization, document, and target folder appear by id only.
  expect(written[0]).not.toContain("Acme");
  expect(written[0]).not.toContain("Projects");
  expect(written[0]).not.toContain(ARCHIVE_NODE.name);
});

test("copies a healthy entry's status", async () => {
  const written = await copyEntry(
    item({
      containerId: null,
      objectKind: "unknown",
      namespace: "ledger",
      operations: [
        operation({ byteLength: 2_048, count: 2, kind: "attachment" }),
      ],
      remoteId: null,
    }),
    "personal-org",
  );

  expect(written).toEqual([
    [
      "Write Queue Entry",
      "Object Kind: unknown",
      "Namespace: ledger",
      "Local ID: document-local-id",
      "Remote ID: -",
      "Container ID: -",
      "Organization ID: personal-org",
      `Status: pending (${EXPLORER_LABELS.writeQueueBillingPaused})`,
      `Created: ${CREATED_AT}`,
      `Updated: ${CREATED_AT}`,
      "Operations:",
      "- attachment x2 (2048 bytes): pending",
    ].join("\n"),
  ]);
});

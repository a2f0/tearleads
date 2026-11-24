import type {
  ContainerNode,
  DomainSyncSnapshot,
  PendingWriteQueueItem,
} from "@tearleads/client-sdk";
import { useId, useMemo } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalHighlight,
  MiniAppModalPanel,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerWriteQueueEntryDetail } from "./ExplorerWriteQueueEntryDetail";
import { getWriteQueueItemKey, getWriteQueueItemName } from "./writeQueueItems";
import "./ExplorerWriteQueueViews.css";

// The dialog names the document and states the consequence: discarding
// deletes queued edits irreversibly, and the action sits next to Retry in
// the row menu, so a mis-tap must not be able to destroy anything.
export function WriteQueueDiscardConfirmDialog(params: {
  item: PendingWriteQueueItem;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  return (
    <MiniAppModalBackdrop role="presentation">
      <MiniAppModalPanel
        role="dialog"
        aria-labelledby={titleId}
        aria-modal="true"
      >
        <MiniAppModalForm
          onSubmit={(event) => {
            event.preventDefault();
            params.onConfirm();
          }}
        >
          <h2 id={titleId}>{EXPLORER_LABELS.writeQueueDiscardConfirmTitle}</h2>
          <MiniAppStatus>
            <MiniAppModalHighlight>
              {getWriteQueueItemName(params.item)}
            </MiniAppModalHighlight>
            {" — "}
            {EXPLORER_LABELS.writeQueueDiscardConfirmBody}
          </MiniAppStatus>
          <MiniAppActions>
            <MiniAppButton onClick={params.onCancel}>Cancel</MiniAppButton>
            <MiniAppButton type="submit">
              {EXPLORER_LABELS.writeQueueDiscardAction}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}

/** Why nothing queued can leave right now: offline, signed out, or billing. */
export function WriteQueueBlockers(params: {
  billingBlockedOrganizationId: string | null;
  isAuthenticated: boolean;
  online: boolean;
  organizationNamesById: ReadonlyMap<string, string>;
}) {
  const messages: string[] = [];
  if (!params.online) {
    messages.push(EXPLORER_LABELS.writeQueueWaitingForNetwork);
  }
  if (!params.isAuthenticated) {
    messages.push(EXPLORER_LABELS.writeQueueSignedOut);
  }
  if (params.billingBlockedOrganizationId) {
    const organization =
      params.organizationNamesById.get(params.billingBlockedOrganizationId) ??
      params.billingBlockedOrganizationId;
    messages.push(
      `${EXPLORER_LABELS.writeQueueBillingPausedMessage} ${organization}.`,
    );
  }
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="explorer-write-queue-blockers" role="status">
      {messages.join(" ")}
    </div>
  );
}

// The read's own error rides along with the label: it is what tells the user
// whether the failure is transient or needs action (e.g. an obsolete local
// schema that only a local database reset fixes).
export function WriteQueueLoadError(params: { error: string }) {
  return (
    <span role="alert">
      {EXPLORER_LABELS.writeQueueFailedToLoad} <span>{params.error}</span>
    </span>
  );
}

interface ExplorerWriteQueueEntryViewProps {
  billingBlockedOrganizationId: string | null;
  // Why the latest pending-write read failed, or null when it succeeded.
  error: string | null;
  isAuthenticated: boolean;
  items: ReadonlyArray<PendingWriteQueueItem>;
  loading: boolean;
  nodes: ReadonlyArray<ContainerNode>;
  online: boolean;
  organizationNamesById: ReadonlyMap<string, string>;
  /** The full (objectKind, namespace, localId) key of the entry shown. */
  selectedEntryKey: string;
  snapshot: DomainSyncSnapshot;
}

function WriteQueueEntryBody(
  params: ExplorerWriteQueueEntryViewProps & {
    selectedEntry: PendingWriteQueueItem | null;
  },
) {
  const containerNamesById = useMemo(
    () => new Map(params.nodes.map((node) => [node.id, node.name])),
    [params.nodes],
  );

  if (params.selectedEntry) {
    return (
      <ExplorerWriteQueueEntryDetail
        billingBlockedOrganizationId={params.billingBlockedOrganizationId}
        containerNamesById={containerNamesById}
        isAuthenticated={params.isAuthenticated}
        item={params.selectedEntry}
        online={params.online}
        organizationNamesById={params.organizationNamesById}
        snapshot={params.snapshot}
      />
    );
  }

  // The entry may not have loaded yet; don't claim it is gone.
  if (params.loading) {
    return <MiniAppStatus>{EXPLORER_LABELS.writeQueueLoading}</MiniAppStatus>;
  }

  // The read failed, so an empty list is a query failure, not an empty queue.
  // Surface the error instead of falsely claiming the change finished syncing.
  if (params.error !== null) {
    return (
      <MiniAppStatus>
        <WriteQueueLoadError error={params.error} />
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppStatus>
      {EXPLORER_LABELS.writeQueueEntryNotQueued}{" "}
      <code>{params.selectedEntryKey}</code>
    </MiniAppStatus>
  );
}

/**
 * One queued entry's detail in place of the whole Outgoing list: why it has
 * not synced yet and each of its pending writes. Its General section names it.
 */
export function ExplorerWriteQueueEntryView(
  params: ExplorerWriteQueueEntryViewProps,
) {
  const selectedEntry =
    params.items.find(
      (item) => getWriteQueueItemKey(item) === params.selectedEntryKey,
    ) ?? null;
  return <WriteQueueEntryBody {...params} selectedEntry={selectedEntry} />;
}

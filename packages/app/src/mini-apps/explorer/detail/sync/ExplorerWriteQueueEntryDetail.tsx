import type {
  DomainSyncSnapshot,
  PendingWriteQueueItem,
} from "@tearleads/client-sdk";
import { MiniAppInfoSection } from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppInfoRow,
  MiniAppKeyValueTable,
} from "../../../../components/mini-app/MiniAppTable";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
import {
  getObjectTypeLabel,
  getOperationLabel,
  getStatusLabel,
  getWriteQueueItemName,
} from "./ExplorerWriteQueueTable";

function formatEntryDateTime(value: string | null): string {
  return formatMiniAppDateTime(value, { emptyFallback: "-" });
}

function getEntryTypeLabel(item: PendingWriteQueueItem): string {
  return item.objectKind === "unknown" && item.namespace
    ? item.namespace
    : getObjectTypeLabel(item.objectKind);
}

// Global blockers stall every write, so they lead the "why is this stuck?"
// summary regardless of this entry's own state.
function getWriteQueueEntryBlockerReasons(params: {
  billingBlockedOrganizationId: string | null;
  isAuthenticated: boolean;
  item: PendingWriteQueueItem;
  online: boolean;
  organizationNamesById: ReadonlyMap<string, string>;
}): string[] {
  const { item } = params;
  const reasons: string[] = [];

  if (!params.online) {
    reasons.push(EXPLORER_LABELS.writeQueueWaitingForNetwork);
  }
  if (!params.isAuthenticated) {
    reasons.push(EXPLORER_LABELS.writeQueueSignedOut);
  }
  if (
    item.organizationId !== null &&
    item.organizationId === params.billingBlockedOrganizationId
  ) {
    const organization =
      params.organizationNamesById.get(item.organizationId) ??
      item.organizationId;
    reasons.push(
      `${EXPLORER_LABELS.writeQueueBillingPausedMessage} ${organization}.`,
    );
  }

  return reasons;
}

function getWriteQueueEntryErrorReasons(item: PendingWriteQueueItem): string[] {
  const errors = new Set<string>();
  for (const operation of item.operations) {
    if (operation.lastError) {
      errors.add(operation.lastError);
    }
  }
  return Array.from(
    errors,
    (error) => `${EXPLORER_LABELS.writeQueueEntryReasonErrorPrefix} ${error}`,
  );
}

// When nothing is actively wrong, say why the change is simply waiting: behind
// an earlier blocked change, an idle coordinator, or its turn in the queue.
function getWriteQueueEntryWaitingReason(
  item: PendingWriteQueueItem,
  snapshot: DomainSyncSnapshot,
): string {
  if (item.status === "blocked") {
    return EXPLORER_LABELS.writeQueueEntryReasonBlocked;
  }
  if (!snapshot.pumpActive && snapshot.hasPendingWork) {
    return EXPLORER_LABELS.writeQueueEntryReasonPumpIdle;
  }
  return EXPLORER_LABELS.writeQueueEntryReasonQueued;
}

function getWriteQueueEntryReasons(params: {
  billingBlockedOrganizationId: string | null;
  isAuthenticated: boolean;
  item: PendingWriteQueueItem;
  online: boolean;
  organizationNamesById: ReadonlyMap<string, string>;
  snapshot: DomainSyncSnapshot;
}): ReadonlyArray<string> {
  const reasons = [
    ...getWriteQueueEntryBlockerReasons(params),
    ...getWriteQueueEntryErrorReasons(params.item),
  ];
  if (reasons.length === 0) {
    reasons.push(getWriteQueueEntryWaitingReason(params.item, params.snapshot));
  }
  return reasons;
}

function ExplorerWriteQueueEntryReasonSection(params: {
  reasons: ReadonlyArray<string>;
}) {
  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.writeQueueEntryReasonHeading}>
      <ul className="explorer-write-queue-entry-reasons" role="status">
        {params.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </MiniAppInfoSection>
  );
}

function ExplorerWriteQueueEntryGeneralSection(params: {
  containerNamesById: ReadonlyMap<string, string>;
  item: PendingWriteQueueItem;
  organizationNamesById: ReadonlyMap<string, string>;
}) {
  const { item } = params;
  const organizationLabel = item.organizationId
    ? (params.organizationNamesById.get(item.organizationId) ??
      item.organizationId)
    : "-";
  const containerLabel = item.containerId
    ? (params.containerNamesById.get(item.containerId) ?? item.containerId)
    : "-";

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.writeQueueEntryGeneralHeading}>
      <MiniAppKeyValueTable>
        <tbody>
          <MiniAppInfoRow label={EXPLORER_LABELS.writeQueueEntryNameRow}>
            {getWriteQueueItemName(item)}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={EXPLORER_LABELS.writeQueueEntryTypeRow}>
            {getEntryTypeLabel(item)}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={EXPLORER_LABELS.writeQueueEntryStatusRow}>
            <span
              className={`explorer-write-queue-status explorer-write-queue-status--${item.status}`}
            >
              {getStatusLabel(item.status)}
            </span>
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.writeQueueEntryOrganizationRow}
            title={item.organizationId}
          >
            {organizationLabel}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.writeQueueEntryContainerRow}
            title={item.containerId}
          >
            {containerLabel}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.writeQueueEntryLocalIdRow}
            title={item.localId}
          >
            <code>{item.localId}</code>
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.writeQueueEntryRemoteIdRow}
            title={item.remoteId}
          >
            {item.remoteId ? <code>{item.remoteId}</code> : "-"}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.writeQueueEntryCreatedRow}
            title={item.createdAt}
          >
            {formatEntryDateTime(item.createdAt)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.writeQueueEntryUpdatedRow}
            title={item.updatedAt}
          >
            {formatEntryDateTime(item.updatedAt)}
          </MiniAppInfoRow>
        </tbody>
      </MiniAppKeyValueTable>
    </MiniAppInfoSection>
  );
}

function ExplorerWriteQueueEntryOperationsSection(params: {
  containerNamesById: ReadonlyMap<string, string>;
  item: PendingWriteQueueItem;
}) {
  const { item } = params;

  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.writeQueueEntryOperationsHeading}
    >
      {item.operations.map((operation) => (
        <MiniAppKeyValueTable key={operation.kind}>
          <tbody>
            <MiniAppInfoRow
              label={getOperationLabel(
                operation,
                item,
                params.containerNamesById,
              )}
            >
              {getStatusLabel(operation.status)}
            </MiniAppInfoRow>
            <MiniAppInfoRow
              label={EXPLORER_LABELS.writeQueueEntryLastErrorRow}
              title={operation.lastError}
            >
              {operation.lastError ?? EXPLORER_LABELS.writeQueueEntryNoError}
            </MiniAppInfoRow>
            <MiniAppInfoRow
              label={EXPLORER_LABELS.writeQueueEntryLastAttemptRow}
              title={operation.lastAttemptedAt}
            >
              {formatEntryDateTime(operation.lastAttemptedAt)}
            </MiniAppInfoRow>
            <MiniAppInfoRow
              label={EXPLORER_LABELS.writeQueueEntryCreatedRow}
              title={operation.createdAt}
            >
              {formatEntryDateTime(operation.createdAt)}
            </MiniAppInfoRow>
            <MiniAppInfoRow
              label={EXPLORER_LABELS.writeQueueEntryUpdatedRow}
              title={operation.updatedAt}
            >
              {formatEntryDateTime(operation.updatedAt)}
            </MiniAppInfoRow>
          </tbody>
        </MiniAppKeyValueTable>
      ))}
    </MiniAppInfoSection>
  );
}

export function ExplorerWriteQueueEntryDetail(params: {
  billingBlockedOrganizationId: string | null;
  containerNamesById: ReadonlyMap<string, string>;
  isAuthenticated: boolean;
  item: PendingWriteQueueItem;
  online: boolean;
  organizationNamesById: ReadonlyMap<string, string>;
  snapshot: DomainSyncSnapshot;
}) {
  const reasons = getWriteQueueEntryReasons({
    billingBlockedOrganizationId: params.billingBlockedOrganizationId,
    isAuthenticated: params.isAuthenticated,
    item: params.item,
    online: params.online,
    organizationNamesById: params.organizationNamesById,
    snapshot: params.snapshot,
  });

  return (
    <div className="explorer-info explorer-write-queue-entry-detail">
      <ExplorerWriteQueueEntryReasonSection reasons={reasons} />
      <ExplorerWriteQueueEntryGeneralSection
        containerNamesById={params.containerNamesById}
        item={params.item}
        organizationNamesById={params.organizationNamesById}
      />
      <ExplorerWriteQueueEntryOperationsSection
        containerNamesById={params.containerNamesById}
        item={params.item}
      />
    </div>
  );
}

import { normalizeEffectiveAccessLevel } from "../../../data/accessLevel";
import type { DocumentSummary } from "../../../data/documentSummary";
import { DEFAULT_DOCUMENT_KIND } from "../../../data/documents/documentConstants";
import type { StoredDocumentKind } from "../../../data/documents/documentKinds";
import {
  type ContainerDocumentObjectSyncState,
  createContainerDocumentObjectSyncState,
} from "../syncState";
import type { ContainerDocumentSidebarRow, ContainerItemRow } from "./types";

export function compareContainerContentsDocumentSummaries(
  left: DocumentSummary,
  right: DocumentSummary,
): number {
  if (right.updatedAt !== left.updatedAt) {
    return right.updatedAt > left.updatedAt ? 1 : -1;
  }

  if (right.id !== left.id) {
    return right.id > left.id ? 1 : -1;
  }

  return 0;
}

function parseContainerContentsContainerItemDocumentKind(
  value: unknown,
): StoredDocumentKind {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : DEFAULT_DOCUMENT_KIND;
}

function readContainerContentsContainerItemString(
  row: Record<string, unknown>,
  key: string,
): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function readContainerContentsContainerItemNullableString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readContainerContentsContainerItemNumber(
  row: Record<string, unknown>,
  key: string,
): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasPendingLocalTimestamp(
  row: Record<string, unknown>,
  localUpdatedAtKey: string,
  serverUpdatedAtKey: string,
): boolean {
  const localUpdatedAt = readContainerContentsContainerItemNullableString(
    row,
    localUpdatedAtKey,
  );
  const serverUpdatedAt = readContainerContentsContainerItemNullableString(
    row,
    serverUpdatedAtKey,
  );

  return (
    localUpdatedAt !== null &&
    (serverUpdatedAt === null || localUpdatedAt > serverUpdatedAt)
  );
}

function readContainerDocumentObjectSyncState(
  row: Record<string, unknown>,
  options: {
    localOnly: boolean;
    localTimestampPending?: boolean | undefined;
  },
): ContainerDocumentObjectSyncState {
  return createContainerDocumentObjectSyncState({
    lastError: readContainerContentsContainerItemNullableString(
      row,
      "sync_last_error",
    ),
    localOnly: options.localOnly,
    pendingAttachmentBytes: readContainerContentsContainerItemNumber(
      row,
      "pending_attachment_bytes",
    ),
    pendingAttachmentCount: readContainerContentsContainerItemNumber(
      row,
      "pending_attachment_count",
    ),
    pendingUpdateCount: Math.max(
      readContainerContentsContainerItemNumber(row, "pending_update_count"),
      options.localTimestampPending ? 1 : 0,
    ),
  });
}

export function mapContainerItemRow(
  containerId: string | null,
  row: Record<string, unknown>,
): ContainerItemRow {
  const itemKind = readContainerContentsContainerItemString(row, "item_kind");
  if (itemKind === "container") {
    return {
      createdAt: readContainerContentsContainerItemNullableString(
        row,
        "created_at",
      ),
      id: readContainerContentsContainerItemString(row, "item_id"),
      icon: readContainerContentsContainerItemNullableString(row, "icon"),
      itemKind: "container",
      name: readContainerContentsContainerItemString(row, "name"),
      syncState: readContainerDocumentObjectSyncState(row, {
        localOnly:
          !readContainerContentsContainerItemNullableString(
            row,
            "server_created_at",
          ) ||
          !readContainerContentsContainerItemNullableString(
            row,
            "metadata_document_id",
          ),
        localTimestampPending: hasPendingLocalTimestamp(
          row,
          "local_updated_at",
          "server_updated_at",
        ),
      }),
      updatedAt: readContainerContentsContainerItemNullableString(
        row,
        "updated_at",
      ),
    };
  }

  return {
    containerId,
    createdAt: readContainerContentsContainerItemNullableString(
      row,
      "created_at",
    ),
    documentId: readContainerContentsContainerItemNullableString(
      row,
      "document_id",
    ),
    documentKind: parseContainerContentsContainerItemDocumentKind(
      readContainerContentsContainerItemString(row, "document_kind"),
    ),
    itemKind: "document",
    localId: readContainerContentsContainerItemString(row, "item_id"),
    name: readContainerContentsContainerItemString(row, "name"),
    syncState: readContainerDocumentObjectSyncState(row, {
      localOnly: !readContainerContentsContainerItemNullableString(
        row,
        "document_id",
      ),
    }),
    updatedAt: readContainerContentsContainerItemNullableString(
      row,
      "updated_at",
    ),
  };
}

export function readContainerContentsContainerItemCount(
  row: Record<string, unknown>,
): number {
  return readContainerContentsContainerItemNumber(row, "total_count");
}

export function mapContainerDocumentSidebarRow(
  row: Record<string, unknown>,
): ContainerDocumentSidebarRow {
  return {
    containerId: readContainerContentsContainerItemNullableString(
      row,
      "container_id",
    ),
    documentId: readContainerContentsContainerItemNullableString(
      row,
      "document_id",
    ),
    documentKind: parseContainerContentsContainerItemDocumentKind(
      readContainerContentsContainerItemString(row, "document_kind"),
    ),
    localId: readContainerContentsContainerItemString(row, "local_id"),
    syncState: readContainerDocumentObjectSyncState(row, {
      localOnly: !readContainerContentsContainerItemNullableString(
        row,
        "document_id",
      ),
    }),
    title: readContainerContentsContainerItemString(row, "title"),
    updatedAt: readContainerContentsContainerItemNullableString(
      row,
      "updated_at",
    ),
  };
}

export function mapContainerContentsDocumentSummaryRow(
  row: Record<string, unknown>,
): DocumentSummary | null {
  const localId = readContainerContentsContainerItemString(row, "local_id");
  if (localId.length === 0) {
    return null;
  }

  return {
    accessStateHash: readContainerContentsContainerItemNullableString(
      row,
      "access_state_hash",
    ),
    effectiveAccessLevel: normalizeEffectiveAccessLevel(
      readContainerContentsContainerItemNullableString(
        row,
        "effective_access_level",
      ),
    ),
    id: localId,
    containerId: readContainerContentsContainerItemNullableString(
      row,
      "container_id",
    ),
    documentId: readContainerContentsContainerItemNullableString(
      row,
      "document_id",
    ),
    documentKind: parseContainerContentsContainerItemDocumentKind(
      readContainerContentsContainerItemString(row, "document_kind"),
    ),
    title: readContainerContentsContainerItemString(row, "title"),
    updatedAt: readContainerContentsContainerItemString(row, "updated_at"),
  };
}

export function mapContainerContentsDocumentSyncStateRow(
  row: Record<string, unknown>,
): ContainerDocumentObjectSyncState {
  return readContainerDocumentObjectSyncState(row, {
    localOnly: !readContainerContentsContainerItemNullableString(
      row,
      "document_id",
    ),
  });
}

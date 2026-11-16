import type { ContainerInfo } from "@tearleads/client-sdk";
import { type ReactNode, useMemo } from "react";
import {
  MiniAppCopyValue,
  MiniAppInfoHeading,
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppCompactTableCell,
  type MiniAppCompactTableField,
  MiniAppCompactTableHeader,
  MiniAppKeyValueList,
  MiniAppKeyValueRow,
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  useMiniAppCompactTableFrame,
} from "../../../../components/mini-app/MiniAppTable";
import { getMiniAppVirtualFrameStyle } from "../../../../components/mini-app/virtual/MiniAppVirtual";
import { classNames } from "../../../../components/shared/classNames";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import {
  EXPLORER_LABELS,
  getExplorerContainerInfoEventLabel,
  getExplorerContainerInfoGrantSummaryLabel,
  getExplorerContainerInfoManifestHistoryLabel,
  getExplorerContainerInfoPathSummaryLabel,
  getExplorerContainerInfoRecipientSummaryLabel,
} from "../../labels";
import { compactId } from "../compactId";
import { ExplorerInfoIdRow } from "../ExplorerInfoIdRow";

type ContainerRemoteInfo = NonNullable<ContainerInfo["remoteInfo"]>;
type SecurityPathEntry = NonNullable<
  ContainerRemoteInfo["security"]
>["path"][number];
type SyncCursor = ContainerRemoteInfo["syncCursors"][number];

type FoldableColumn = { readonly id: string; readonly label: string };

/**
 * Folded, the first column leads and the rest share the muted second line
 * under their own header labels (these values are ids and counts, so they are
 * not self-describing). Unfolded, every column stands on its own.
 */
function getFoldableColumns(
  primary: FoldableColumn,
  secondary: ReadonlyArray<FoldableColumn>,
  compact: boolean,
): ReadonlyArray<MiniAppTableColumn> {
  if (compact) {
    return [
      {
        header: (
          <MiniAppCompactTableHeader
            primary={[{ id: primary.id, text: primary.label }]}
            secondary={secondary.map((column) => ({
              id: column.id,
              text: column.label,
            }))}
          />
        ),
        id: "summary",
      },
    ];
  }

  return [primary, ...secondary].map((column) => ({
    header: column.label,
    id: column.id,
  }));
}

function FoldableInfoTable(params: {
  ariaLabel: string;
  primary: FoldableColumn;
  renderRows: (compact: boolean) => ReactNode;
  secondary: ReadonlyArray<FoldableColumn>;
}) {
  const { ariaLabel, primary, renderRows, secondary } = params;
  const { compact, frameRef, rowHeight } = useMiniAppCompactTableFrame();
  const columns = useMemo(
    () => getFoldableColumns(primary, secondary, compact),
    [compact, primary, secondary],
  );

  return (
    <MiniAppTableFrame
      className={classNames(
        compact &&
          "mini-app-table-frame--compact mini-app-table-frame--two-line",
      )}
      ref={frameRef}
      style={getMiniAppVirtualFrameStyle(rowHeight)}
    >
      <MiniAppTable aria-label={ariaLabel} columns={columns}>
        {renderRows(compact)}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

const SECURITY_PATH_PRIMARY_COLUMN = {
  id: "path",
  label: EXPLORER_LABELS.containerInfoPathColumn,
} as const;

/** The folded row's muted second line, shared by header and body. */
const SECURITY_PATH_SECONDARY_COLUMNS = [
  { id: "manifest", label: EXPLORER_LABELS.containerInfoManifestColumn },
  { id: "epoch", label: EXPLORER_LABELS.containerInfoSecurityKeyEpochRow },
  { id: "recipients", label: EXPLORER_LABELS.containerInfoRecipientsColumn },
] as const;

function getRecipientSummary(entry: SecurityPathEntry): string {
  return getExplorerContainerInfoRecipientSummaryLabel({
    recipientTargetCount: entry.recipientTargetCount,
    wrapCount: entry.wrapCount,
  });
}

function getGrantSummary(entry: SecurityPathEntry): string {
  return getExplorerContainerInfoGrantSummaryLabel({
    directGrantCount: entry.directGrantCount,
    referencedPrincipalCount: entry.referencedPrincipalCount,
  });
}

function getSecurityPathSecondaryFields(
  entry: SecurityPathEntry,
): ReadonlyArray<MiniAppCompactTableField> {
  const [manifest, epoch, recipients] = SECURITY_PATH_SECONDARY_COLUMNS;
  const eventLabel = getExplorerContainerInfoEventLabel(
    compactId(entry.eventHash),
  );
  return [
    {
      ...manifest,
      text: `${compactId(entry.manifestHash)} · ${eventLabel}`,
      title: `${entry.manifestHash} ${entry.eventHash}`,
    },
    {
      ...epoch,
      text: `${entry.containerKeyEpoch} / ${compactId(entry.containerKeyEpochId)}`,
      title: entry.containerKeyEpochId,
    },
    {
      ...recipients,
      text: `${getRecipientSummary(entry)} · ${getGrantSummary(entry)}`,
    },
  ];
}

function SecurityPathRow(params: {
  compact: boolean;
  containerName: string;
  entry: SecurityPathEntry;
}) {
  const { compact, containerName, entry } = params;
  if (compact) {
    return (
      <MiniAppTableRow>
        <MiniAppCompactTableCell
          primary={[
            { id: "path", text: containerName, title: entry.containerId },
          ]}
          secondary={getSecurityPathSecondaryFields(entry)}
        />
      </MiniAppTableRow>
    );
  }

  return (
    <MiniAppTableRow>
      <MiniAppTableCell>
        <MiniAppTableText title={entry.containerId}>
          {containerName}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText title={entry.manifestHash}>
          {compactId(entry.manifestHash)}
        </MiniAppTableText>
        <MiniAppTableText title={entry.eventHash}>
          <code>
            {getExplorerContainerInfoEventLabel(compactId(entry.eventHash))}
          </code>
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText>{entry.containerKeyEpoch}</MiniAppTableText>
        <MiniAppTableText title={entry.containerKeyEpochId}>
          <code>{compactId(entry.containerKeyEpochId)}</code>
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText>{getRecipientSummary(entry)}</MiniAppTableText>
        <MiniAppTableText>{getGrantSummary(entry)}</MiniAppTableText>
      </MiniAppTableCell>
    </MiniAppTableRow>
  );
}

function SecuritySummaryList(params: {
  security: NonNullable<ContainerRemoteInfo["security"]>;
}) {
  const { security } = params;
  return (
    <MiniAppKeyValueList>
      <ExplorerInfoIdRow
        label={EXPLORER_LABELS.containerInfoSecurityManifestHashRow}
        value={security.currentManifestHash}
      />
      <MiniAppKeyValueRow
        label={EXPLORER_LABELS.containerInfoSecurityKeyEpochRow}
      >
        {security.currentContainerKeyEpoch} /{" "}
        <MiniAppCopyValue
          display={compactId(security.currentContainerKeyEpochId)}
          label={EXPLORER_LABELS.containerInfoSecurityKeyEpochRow}
          value={security.currentContainerKeyEpochId}
        />
      </MiniAppKeyValueRow>
      <ExplorerInfoIdRow
        label={EXPLORER_LABELS.containerInfoSecurityParentKeyEpochRow}
        value={security.currentParentContainerKeyEpochId}
      />
      <MiniAppKeyValueRow
        label={EXPLORER_LABELS.containerInfoManifestHistoryRow}
      >
        {getExplorerContainerInfoManifestHistoryLabel(
          security.currentManifestHistoryCount,
        )}
      </MiniAppKeyValueRow>
      <MiniAppKeyValueRow label={EXPLORER_LABELS.containerInfoPathRow}>
        {getExplorerContainerInfoPathSummaryLabel({
          pathLength: security.pathLength,
          referencedPrincipalCount: security.currentReferencedPrincipalCount,
        })}
      </MiniAppKeyValueRow>
    </MiniAppKeyValueList>
  );
}

export function ExplorerContainerInfoSecuritySection(params: {
  containerNamesById: ReadonlyMap<string, string>;
  remoteInfo: ContainerRemoteInfo;
}) {
  const { containerNamesById, remoteInfo } = params;
  const security = remoteInfo.security;
  if (!security) {
    return null;
  }

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.containerInfoSecurityHeading}>
      <SecuritySummaryList security={security} />
      <MiniAppInfoHeading>
        {EXPLORER_LABELS.containerInfoPathHeading}
      </MiniAppInfoHeading>
      <FoldableInfoTable
        ariaLabel={EXPLORER_LABELS.containerInfoPathHeading}
        primary={SECURITY_PATH_PRIMARY_COLUMN}
        renderRows={(compact) =>
          security.path.map((entry) => (
            <SecurityPathRow
              compact={compact}
              containerName={
                containerNamesById.get(entry.containerId) ??
                compactId(entry.containerId)
              }
              entry={entry}
              key={`${entry.containerId}:${entry.manifestHash}`}
            />
          ))
        }
        secondary={SECURITY_PATH_SECONDARY_COLUMNS}
      />
    </MiniAppInfoSection>
  );
}

const SYNC_CURSOR_PRIMARY_COLUMN = {
  id: "lane",
  label: EXPLORER_LABELS.containerInfoLaneColumn,
} as const;

/** The folded row's muted second line, shared by header and body. */
const SYNC_CURSOR_SECONDARY_COLUMNS = [
  { id: "cursor", label: EXPLORER_LABELS.containerInfoCursorColumn },
  { id: "saved", label: EXPLORER_LABELS.containerInfoSavedColumn },
] as const;

function getSyncCursorSecondaryFields(
  cursor: SyncCursor,
): ReadonlyArray<MiniAppCompactTableField> {
  const [cursorColumn, saved] = SYNC_CURSOR_SECONDARY_COLUMNS;
  const savedField = {
    ...saved,
    text: formatMiniAppDateTime(cursor.savedAt, { emptyFallback: "-" }),
    title: cursor.savedAt ?? undefined,
  };
  if (!cursor.watermarkUpdatedAt) {
    return [
      { ...cursorColumn, text: EXPLORER_LABELS.containerInfoNoLocalCursor },
      savedField,
    ];
  }

  return [
    {
      ...cursorColumn,
      text: formatMiniAppDateTime(cursor.watermarkUpdatedAt),
      title: [cursor.watermarkUpdatedAt, cursor.watermarkId]
        .filter(Boolean)
        .join(" "),
    },
    savedField,
  ];
}

function SyncCursorCursorCell(params: { cursor: SyncCursor }) {
  const { cursor } = params;
  if (!cursor.watermarkUpdatedAt) {
    return (
      <MiniAppTableCell>
        <MiniAppStatus as="span">
          {EXPLORER_LABELS.containerInfoNoLocalCursor}
        </MiniAppStatus>
      </MiniAppTableCell>
    );
  }

  return (
    <MiniAppTableCell>
      <MiniAppTableText title={cursor.watermarkUpdatedAt}>
        {formatMiniAppDateTime(cursor.watermarkUpdatedAt)}
      </MiniAppTableText>
      <MiniAppTableText title={cursor.watermarkId ?? undefined}>
        <code>{cursor.watermarkId ? compactId(cursor.watermarkId) : ""}</code>
      </MiniAppTableText>
    </MiniAppTableCell>
  );
}

function SyncCursorRow(params: { compact: boolean; cursor: SyncCursor }) {
  const { compact, cursor } = params;
  const laneTitle = `${cursor.laneKind}:${cursor.laneId}`;
  if (compact) {
    return (
      <MiniAppTableRow>
        <MiniAppCompactTableCell
          primary={[{ id: "lane", text: cursor.label, title: laneTitle }]}
          secondary={getSyncCursorSecondaryFields(cursor)}
        />
      </MiniAppTableRow>
    );
  }

  return (
    <MiniAppTableRow>
      <MiniAppTableCell>
        <MiniAppTableText>{cursor.label}</MiniAppTableText>
        <MiniAppTableText title={laneTitle}>
          <code>
            {cursor.laneKind}/{cursor.laneId}
          </code>
        </MiniAppTableText>
      </MiniAppTableCell>
      <SyncCursorCursorCell cursor={cursor} />
      <MiniAppTableCell>
        <MiniAppTableText title={cursor.savedAt ?? undefined}>
          {formatMiniAppDateTime(cursor.savedAt, { emptyFallback: "-" })}
        </MiniAppTableText>
      </MiniAppTableCell>
    </MiniAppTableRow>
  );
}

export function ExplorerContainerInfoSyncCursorsSection(params: {
  remoteInfo: ContainerRemoteInfo;
}) {
  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.containerInfoSyncCursorsHeading}
    >
      <FoldableInfoTable
        ariaLabel={EXPLORER_LABELS.containerInfoSyncCursorsHeading}
        primary={SYNC_CURSOR_PRIMARY_COLUMN}
        renderRows={(compact) =>
          params.remoteInfo.syncCursors.map((cursor) => (
            <SyncCursorRow
              compact={compact}
              cursor={cursor}
              key={`${cursor.laneKind}:${cursor.laneId}`}
            />
          ))
        }
        secondary={SYNC_CURSOR_SECONDARY_COLUMNS}
      />
    </MiniAppInfoSection>
  );
}

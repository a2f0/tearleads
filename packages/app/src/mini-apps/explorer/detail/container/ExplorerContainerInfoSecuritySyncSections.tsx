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
  getExplorerContainerInfoManifestHistoryLabel,
  getExplorerContainerInfoPathSummaryLabel,
} from "../../labels";
import { compactId } from "../compactId";
import { ExplorerInfoIdRow } from "../ExplorerInfoIdRow";
import {
  getSecurityPathDetail,
  getSecurityPathGrantSummary,
  getSecurityPathKey,
  getSecurityPathRecipientSummary,
  getSyncCursorDetail,
  getSyncCursorKey,
  getSyncCursorLaneId,
  type SecurityPathEntry,
  type SyncCursor,
} from "../row-detail/containerInfoRowDetails";
import {
  type ExplorerInfoRowDetail,
  ExplorerInfoRowDetailButton,
  type ExplorerInfoRowDetailOpeners,
  useExplorerInfoRowDetail,
} from "../row-detail/ExplorerInfoRowDetail";

type ContainerRemoteInfo = NonNullable<ContainerInfo["remoteInfo"]>;

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

/** Every row opens its detail: its full fields, with ids that copy. */
function FoldableInfoTable<TRow>(params: {
  ariaLabel: string;
  getDetail: (row: TRow) => ExplorerInfoRowDetail;
  getKey: (row: TRow) => string;
  primary: FoldableColumn;
  renderRow: (
    row: TRow,
    compact: boolean,
    openers: ExplorerInfoRowDetailOpeners,
  ) => ReactNode;
  rows: ReadonlyArray<TRow>;
  secondary: ReadonlyArray<FoldableColumn>;
}) {
  const { ariaLabel, getDetail, getKey, primary, rows, secondary } = params;
  const { compact, frameRef, rowHeight } = useMiniAppCompactTableFrame();
  const columns = useMemo(
    () => getFoldableColumns(primary, secondary, compact),
    [compact, primary, secondary],
  );
  const { detailOverlay, getRowDetailOpeners } = useExplorerInfoRowDetail({
    getDetail,
    getKey,
    rows,
  });

  return (
    <>
      <MiniAppTableFrame
        className={classNames(
          compact &&
            "mini-app-table-frame--compact mini-app-table-frame--two-line",
        )}
        ref={frameRef}
        style={getMiniAppVirtualFrameStyle(rowHeight)}
      >
        <MiniAppTable aria-label={ariaLabel} columns={columns}>
          {rows.map((row) =>
            params.renderRow(row, compact, getRowDetailOpeners(row)),
          )}
        </MiniAppTable>
      </MiniAppTableFrame>
      {detailOverlay}
    </>
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
      text: `${getSecurityPathRecipientSummary(entry)} · ${getSecurityPathGrantSummary(entry)}`,
    },
  ];
}

function SecurityPathRow(params: {
  compact: boolean;
  containerName: string;
  entry: SecurityPathEntry;
  openers: ExplorerInfoRowDetailOpeners;
}) {
  const { compact, containerName, entry, openers } = params;
  const detailButton = (
    <ExplorerInfoRowDetailButton
      onOpen={openers.openFromControl}
      text={containerName}
      title={entry.containerId}
    />
  );
  if (compact) {
    return (
      <MiniAppTableRow interactive onActivate={openers.openFromRow}>
        <MiniAppCompactTableCell
          primary={[
            { content: detailButton, id: "path", title: entry.containerId },
          ]}
          secondary={getSecurityPathSecondaryFields(entry)}
        />
      </MiniAppTableRow>
    );
  }

  return (
    <MiniAppTableRow interactive onActivate={openers.openFromRow}>
      <MiniAppTableCell>{detailButton}</MiniAppTableCell>
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
        <MiniAppTableText>
          {getSecurityPathRecipientSummary(entry)}
        </MiniAppTableText>
        <MiniAppTableText>
          {getSecurityPathGrantSummary(entry)}
        </MiniAppTableText>
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
  const getName = (entry: SecurityPathEntry) =>
    containerNamesById.get(entry.containerId) ?? compactId(entry.containerId);

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.containerInfoSecurityHeading}>
      <SecuritySummaryList security={security} />
      <MiniAppInfoHeading>
        {EXPLORER_LABELS.containerInfoPathHeading}
      </MiniAppInfoHeading>
      <FoldableInfoTable
        ariaLabel={EXPLORER_LABELS.containerInfoPathHeading}
        getDetail={(entry) => getSecurityPathDetail(entry, getName(entry))}
        getKey={getSecurityPathKey}
        primary={SECURITY_PATH_PRIMARY_COLUMN}
        renderRow={(entry, compact, openers) => (
          <SecurityPathRow
            compact={compact}
            containerName={getName(entry)}
            entry={entry}
            key={getSecurityPathKey(entry)}
            openers={openers}
          />
        )}
        rows={security.path}
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

function SyncCursorRow(params: {
  compact: boolean;
  cursor: SyncCursor;
  openers: ExplorerInfoRowDetailOpeners;
}) {
  const { compact, cursor, openers } = params;
  const laneId = getSyncCursorLaneId(cursor);
  if (compact) {
    return (
      <MiniAppTableRow interactive onActivate={openers.openFromRow}>
        <MiniAppCompactTableCell
          primary={[
            {
              content: (
                <ExplorerInfoRowDetailButton
                  onOpen={openers.openFromControl}
                  text={cursor.label}
                  title={laneId}
                />
              ),
              id: "lane",
              title: laneId,
            },
          ]}
          secondary={getSyncCursorSecondaryFields(cursor)}
        />
      </MiniAppTableRow>
    );
  }

  return (
    <MiniAppTableRow interactive onActivate={openers.openFromRow}>
      <MiniAppTableCell>
        <ExplorerInfoRowDetailButton
          onOpen={openers.openFromControl}
          text={cursor.label}
        />
        <MiniAppTableText title={laneId}>
          <code>{laneId}</code>
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
        getDetail={getSyncCursorDetail}
        getKey={getSyncCursorKey}
        primary={SYNC_CURSOR_PRIMARY_COLUMN}
        renderRow={(cursor, compact, openers) => (
          <SyncCursorRow
            compact={compact}
            cursor={cursor}
            key={getSyncCursorKey(cursor)}
            openers={openers}
          />
        )}
        rows={params.remoteInfo.syncCursors}
        secondary={SYNC_CURSOR_SECONDARY_COLUMNS}
      />
    </MiniAppInfoSection>
  );
}

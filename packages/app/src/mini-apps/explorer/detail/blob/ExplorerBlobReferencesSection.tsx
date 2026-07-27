import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import type {
  BlobInfo,
  BlobInfoDocumentReference,
} from "@tearleads/client-sdk";
import { type MouseEvent, useMemo } from "react";
import { MiniAppInfoSection } from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppCompactTableCell,
  type MiniAppCompactTableField,
  MiniAppCompactTableHeader,
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  useMiniAppCompactTableFrame,
} from "../../../../components/mini-app/MiniAppTable";
import { getMiniAppVirtualFrameStyle } from "../../../../components/mini-app/virtual/MiniAppVirtual";
import { classNames } from "../../../../components/shared/classNames";
import { Menu } from "../../../../components/shared/Menu";
import { MenuItem } from "../../../../components/shared/MenuItem";
import {
  type ContextMenuState,
  useContextMenuState,
} from "../../../../components/shared/useContextMenuState";
import {
  EXPLORER_LABELS,
  getExplorerDocumentInfoAttachmentKindLabel,
} from "../../labels";
import { compactId } from "../compactId";

/**
 * The folded row's muted second line, in order. One list for both the header
 * labels and the body fields, so the two lines cannot drift out of step.
 */
const BLOB_REFERENCE_SECONDARY_COLUMNS = [
  { id: "container", label: EXPLORER_LABELS.documentInfoContainerColumn },
  { id: "state", label: EXPLORER_LABELS.blobBrowserStateColumn },
  { id: "slot", label: EXPLORER_LABELS.blobBrowserSlotColumn },
] as const;

/**
 * Folded, the four columns become one summary cell: the document leads, and
 * Container / State / Slot share the muted second line. Unfolded, they stay the
 * four columns they were — three of which are an id or a one-word state, so
 * they are the ones a narrow frame squeezes to nothing first.
 */
function getBlobReferenceColumns(
  compact: boolean,
): ReadonlyArray<MiniAppTableColumn> {
  if (compact) {
    return [
      {
        header: (
          <MiniAppCompactTableHeader
            primary={[
              {
                id: "document",
                text: EXPLORER_LABELS.blobBrowserDocumentColumn,
              },
            ]}
            secondary={BLOB_REFERENCE_SECONDARY_COLUMNS.map((column) => ({
              id: column.id,
              text: column.label,
            }))}
          />
        ),
        id: "summary",
      },
    ];
  }

  return [
    {
      header: EXPLORER_LABELS.blobBrowserDocumentColumn,
      id: "document",
      width: "46%",
    },
    {
      header: EXPLORER_LABELS.documentInfoContainerColumn,
      id: "container",
      width: "28%",
    },
    {
      header: EXPLORER_LABELS.blobBrowserStateColumn,
      id: "state",
      width: "6rem",
    },
    {
      header: EXPLORER_LABELS.blobBrowserSlotColumn,
      id: "slot",
      width: "8rem",
    },
  ];
}

type BlobReferenceContextTarget = {
  attachmentKind: BlobInfoDocumentReference["attachmentKind"];
  containerId: string;
  localId: string;
  slotId: string;
};

function getBlobReferenceKey(reference: BlobInfoDocumentReference): string {
  return [
    reference.attachmentKind,
    reference.containerId ?? "",
    reference.localId,
    reference.slotId,
  ].join(":");
}

function isBlobReferenceContextTarget(
  reference: BlobInfoDocumentReference,
  target: BlobReferenceContextTarget | null,
): boolean {
  return (
    target !== null &&
    reference.attachmentKind === target.attachmentKind &&
    reference.containerId === target.containerId &&
    reference.localId === target.localId &&
    reference.slotId === target.slotId
  );
}

function getBlobReferenceContextTarget(
  reference: BlobInfoDocumentReference,
): BlobReferenceContextTarget | null {
  if (!reference.containerId) {
    return null;
  }

  return {
    attachmentKind: reference.attachmentKind,
    containerId: reference.containerId,
    localId: reference.localId,
    slotId: reference.slotId,
  };
}

function BlobReferenceContextMenu(params: {
  closeContextMenu: () => void;
  contextMenu: ContextMenuState<BlobReferenceContextTarget>;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
}) {
  return (
    <Menu
      direction="down"
      onClose={params.closeContextMenu}
      position={params.contextMenu.position}
    >
      <MenuItem
        icon={InfoIcon}
        label={EXPLORER_LABELS.documentInfoGetInfoAction}
        onClick={() => {
          params.closeContextMenu();
          params.openDocumentInfoRoute(
            params.contextMenu.id.localId,
            params.contextMenu.id.containerId,
          );
        }}
      />
    </Menu>
  );
}

function getBlobReferenceContainerLabel(
  reference: BlobInfoDocumentReference,
  containerName: string | null,
): string {
  return (
    containerName ??
    (reference.containerId ? compactId(reference.containerId) : "-")
  );
}

function getBlobReferenceSecondaryFields(
  reference: BlobInfoDocumentReference,
  containerName: string | null,
): ReadonlyArray<MiniAppCompactTableField> {
  const [container, state, slot] = BLOB_REFERENCE_SECONDARY_COLUMNS;

  return [
    {
      ...container,
      text: getBlobReferenceContainerLabel(reference, containerName),
      title: reference.containerId ?? undefined,
    },
    {
      ...state,
      text: getExplorerDocumentInfoAttachmentKindLabel(
        reference.attachmentKind,
      ),
    },
    {
      ...slot,
      text: compactId(reference.slotId),
      title: reference.slotId,
    },
  ];
}

function BlobReferenceRow(params: {
  compact: boolean;
  containerName: string | null;
  contextTarget: BlobReferenceContextTarget | null;
  onContextMenu: (
    event: MouseEvent<HTMLElement>,
    target: BlobReferenceContextTarget,
  ) => void;
  reference: BlobInfoDocumentReference;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
}) {
  const { compact, containerName, contextTarget, onContextMenu, reference } =
    params;
  const contextMenuTarget = getBlobReferenceContextTarget(reference);
  const canOpenDocument = contextMenuTarget !== null;
  const documentLabel = reference.documentTitle ?? compactId(reference.localId);
  const openDocument = contextMenuTarget
    ? () => {
        params.selectDocumentProjection(
          reference.localId,
          contextMenuTarget.containerId,
        );
      }
    : undefined;
  // The same control on both layouts — folded it becomes the summary's primary
  // line, so the row keeps one focusable, labelled way into the document rather
  // than trading it for plain text.
  const documentButton = (
    <MiniAppTableActionButton
      className="explorer-blob-reference-row-button"
      disabled={!canOpenDocument}
      onClick={openDocument}
    >
      <MiniAppTableText title={documentLabel}>{documentLabel}</MiniAppTableText>
    </MiniAppTableActionButton>
  );

  return (
    <MiniAppTableRow
      className="explorer-blob-reference-table-row"
      interactive={canOpenDocument}
      onActivate={openDocument}
      onContextMenu={
        contextMenuTarget
          ? (event) => onContextMenu(event, contextMenuTarget)
          : undefined
      }
      selected={isBlobReferenceContextTarget(reference, contextTarget)}
    >
      {compact ? (
        <MiniAppCompactTableCell
          primary={[
            {
              content: documentButton,
              id: "document",
              title: reference.localId,
            },
          ]}
          secondary={getBlobReferenceSecondaryFields(reference, containerName)}
        />
      ) : (
        <>
          <MiniAppTableCell title={reference.localId}>
            {documentButton}
          </MiniAppTableCell>
          <MiniAppTableCell title={reference.containerId ?? undefined}>
            {getBlobReferenceContainerLabel(reference, containerName)}
          </MiniAppTableCell>
          <MiniAppTableCell>
            {getExplorerDocumentInfoAttachmentKindLabel(
              reference.attachmentKind,
            )}
          </MiniAppTableCell>
          <MiniAppTableCell title={reference.slotId}>
            {compactId(reference.slotId)}
          </MiniAppTableCell>
        </>
      )}
    </MiniAppTableRow>
  );
}

export function BlobReferencesSection(params: {
  blob: BlobInfo;
  containerNamesById: ReadonlyMap<string, string>;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
}) {
  const { compact, frameRef, rowHeight } = useMiniAppCompactTableFrame();
  const columns = useMemo(() => getBlobReferenceColumns(compact), [compact]);
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<BlobReferenceContextTarget>();

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.blobBrowserReferencesHeading}>
      <MiniAppTableFrame
        // Both modifiers, and only when folded: the two-line pitch rule is
        // written against the pair, and the denser `--compact` cell padding
        // belongs with the fold — unfolded, the section keeps the roomier
        // four-column table it has always been.
        className={classNames(
          compact &&
            "mini-app-table-frame--compact mini-app-table-frame--two-line",
        )}
        ref={frameRef}
        style={getMiniAppVirtualFrameStyle(rowHeight)}
      >
        <MiniAppTable
          aria-label={EXPLORER_LABELS.blobBrowserReferencesHeading}
          columns={columns}
        >
          {params.blob.references.map((reference) => {
            const containerName = reference.containerId
              ? (params.containerNamesById.get(reference.containerId) ?? null)
              : null;

            return (
              <BlobReferenceRow
                compact={compact}
                containerName={containerName}
                contextTarget={contextMenu?.id ?? null}
                key={getBlobReferenceKey(reference)}
                onContextMenu={openContextMenu}
                reference={reference}
                selectDocumentProjection={params.selectDocumentProjection}
              />
            );
          })}
        </MiniAppTable>
      </MiniAppTableFrame>
      {contextMenu ? (
        <BlobReferenceContextMenu
          closeContextMenu={closeContextMenu}
          contextMenu={contextMenu}
          openDocumentInfoRoute={params.openDocumentInfoRoute}
        />
      ) : null}
    </MiniAppInfoSection>
  );
}

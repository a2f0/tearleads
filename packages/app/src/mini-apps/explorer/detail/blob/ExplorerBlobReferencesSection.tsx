import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import type {
  BlobInfo,
  BlobInfoDocumentReference,
} from "@tearleads/client-sdk";
import {
  type ContextMenuState,
  Menu,
  MenuItem,
  useContextMenuState,
} from "@tearleads/windowing";
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
import { getDocumentTypeIcon } from "../../../../document-types/registry";
import { getBlobDisplayName } from "../../../shared/blob-pick/blob-list/blobListState";
import {
  EXPLORER_LABELS,
  getExplorerDocumentInfoAttachmentKindLabel,
} from "../../labels";
import { compactId } from "../compactId";
import "./ExplorerBlobReferencesSection.css";

/**
 * The folded row's muted second line: State · Container · Filename as one
 * joined field, the way Get Info folds a document's attachments. Each value is
 * self-describing, and three equal-width fields would each truncate on a
 * phone. The state leads because it is what tells a document's local and
 * pending links apart; the filename trails because it is usually the blob's
 * own, already shown above, and the one most likely to be cut short. The slot
 * id, an opaque key, stays in the wide layout only. Shared by the header label
 * and the body text.
 */
const BLOB_REFERENCE_SECONDARY_SEPARATOR = " · ";

const BLOB_REFERENCE_SECONDARY_LABEL = [
  EXPLORER_LABELS.blobBrowserStateColumn,
  EXPLORER_LABELS.documentInfoContainerColumn,
  EXPLORER_LABELS.blobBrowserFilenameColumn,
].join(BLOB_REFERENCE_SECONDARY_SEPARATOR);

/**
 * Folded, the row reads like the Explorer's own item list: the document's kind
 * glyph spans both lines, its title leads, and the details sit muted beneath.
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
            secondary={[
              { id: "details", text: BLOB_REFERENCE_SECONDARY_LABEL },
            ]}
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
      width: "28%",
    },
    {
      header: EXPLORER_LABELS.blobBrowserFilenameColumn,
      id: "filename",
      width: "28%",
    },
    {
      header: EXPLORER_LABELS.documentInfoContainerColumn,
      id: "container",
      width: "20%",
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

function getBlobReferenceSecondaryField(
  reference: BlobInfoDocumentReference,
  containerName: string | null,
): MiniAppCompactTableField {
  const text = [
    getExplorerDocumentInfoAttachmentKindLabel(reference.attachmentKind),
    getBlobReferenceContainerLabel(reference, containerName),
    getBlobDisplayName(reference),
  ].join(BLOB_REFERENCE_SECONDARY_SEPARATOR);

  return {
    id: "details",
    label: BLOB_REFERENCE_SECONDARY_LABEL,
    text,
    title: text,
  };
}

/** The document's kind glyph, or the generic file glyph when it is unknown. */
function BlobReferenceDocumentIcon(params: {
  documentKind: BlobInfoDocumentReference["documentKind"];
}) {
  const Glyph = params.documentKind
    ? getDocumentTypeIcon(params.documentKind)
    : FileIcon;

  return (
    <Glyph
      aria-hidden="true"
      className="explorer-blob-reference-icon"
      data-icon={params.documentKind ?? undefined}
      focusable="false"
      size={32}
      weight="regular"
    />
  );
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
  const filename = getBlobDisplayName(reference);
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
  // than trading it for plain text. The row is the touch target either way.
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
          secondary={[getBlobReferenceSecondaryField(reference, containerName)]}
          visual={
            <BlobReferenceDocumentIcon documentKind={reference.documentKind} />
          }
        />
      ) : (
        <>
          <MiniAppTableCell title={reference.localId}>
            {documentButton}
          </MiniAppTableCell>
          <MiniAppTableCell title={filename}>
            <MiniAppTableText>{filename}</MiniAppTableText>
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
        // multi-column layout.
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

import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import type {
  BlobInfo,
  BlobInfoDocumentReference,
} from "@tearleads/client-sdk";
import { type MouseEvent, useMemo } from "react";
import { MiniAppInfoSection } from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../../../components/mini-app/MiniAppTable";
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

function getBlobReferenceColumns(): ReadonlyArray<MiniAppTableColumn> {
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

function BlobReferenceRow(params: {
  containerName: string | null;
  contextTarget: BlobReferenceContextTarget | null;
  onContextMenu: (
    event: MouseEvent<HTMLElement>,
    target: BlobReferenceContextTarget,
  ) => void;
  reference: BlobInfoDocumentReference;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
}) {
  const { containerName, contextTarget, onContextMenu, reference } = params;
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
      <MiniAppTableCell title={reference.localId}>
        <MiniAppTableActionButton
          className="explorer-blob-reference-row-button"
          disabled={!canOpenDocument}
          onClick={openDocument}
        >
          <MiniAppTableText title={documentLabel}>
            {documentLabel}
          </MiniAppTableText>
        </MiniAppTableActionButton>
      </MiniAppTableCell>
      <MiniAppTableCell title={reference.containerId ?? undefined}>
        {containerName ??
          (reference.containerId ? compactId(reference.containerId) : "-")}
      </MiniAppTableCell>
      <MiniAppTableCell>
        {getExplorerDocumentInfoAttachmentKindLabel(reference.attachmentKind)}
      </MiniAppTableCell>
      <MiniAppTableCell title={reference.slotId}>
        {compactId(reference.slotId)}
      </MiniAppTableCell>
    </MiniAppTableRow>
  );
}

export function BlobReferencesSection(params: {
  blob: BlobInfo;
  containerNamesById: ReadonlyMap<string, string>;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
}) {
  const columns = useMemo(() => getBlobReferenceColumns(), []);
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<BlobReferenceContextTarget>();

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.blobBrowserReferencesHeading}>
      <MiniAppTableFrame>
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

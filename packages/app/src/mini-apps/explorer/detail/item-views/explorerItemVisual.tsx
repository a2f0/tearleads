import type { Icon } from "@phosphor-icons/react";
import type { ContainerItemRow } from "@tearleads/client-sdk";
import type { ReactNode } from "react";
import { MiniAppItemThumb } from "../../../../components/mini-app/item-view/MiniAppItemThumb";
import { getDocumentTypeIcon } from "../../../../document-types/registry";
import { DocumentAvatarImage } from "../../../../document-types/shared/avatar/DocumentAvatarImage";
import type { AvatarUrlById } from "../../../../document-types/shared/avatar/useAvatarUrls";
import { getViewerRelativeContactDocumentLabel } from "../../../../stores/contacts/contactLabels";
import { getExplorerContainerIcon } from "../../shared/explorerContainerIcons";
import { getExplorerDocumentAvatar } from "../../shared/explorerDocumentAvatar";

// The item's name and its leading visual, shared by every view of the item
// list: the table's name and summary cells, and the grid's tiles.

export function getExplorerContainerItemName(ctx: {
  currentSigningFingerprint: string | null | undefined;
  currentSelfContactLocalId: string | null | undefined;
  currentUserId: string | null | undefined;
  row: ContainerItemRow;
}): string {
  const { row } = ctx;
  if (row.itemKind !== "document") {
    return row.name;
  }

  return getViewerRelativeContactDocumentLabel({
    currentSigningFingerprint: ctx.currentSigningFingerprint,
    currentSelfContactLocalId: ctx.currentSelfContactLocalId,
    currentUserId: ctx.currentUserId,
    documentKind: row.documentKind,
    fallbackLabel: row.name,
    localId: row.localId,
  });
}

// A configured glyph for containers, otherwise the document kind's shared icon
// (the same mapping the "New Document" picker uses).
function getExplorerItemIcon(row: ContainerItemRow): {
  containerIcon: string | null;
  Icon: Icon;
  name: string;
} {
  if (row.itemKind === "container") {
    const containerIcon = getExplorerContainerIcon({
      icon: row.icon,
      isOpen: false,
    });
    return {
      containerIcon: containerIcon.containerIcon,
      Icon: containerIcon.Component,
      name: containerIcon.name,
    };
  }

  return {
    containerIcon: null,
    Icon: getDocumentTypeIcon(row.documentKind),
    name: row.documentKind,
  };
}

/**
 * How large the visual draws: beside the name in a dense row, spanning the two
 * lines of a folded row, or filling a square sized by the view (a large row's
 * thumbnail, a grid tile) — the view's stylesheet sizes that square.
 */
type ExplorerItemVisualSize = "fill" | "inline" | "summary";

const EXPLORER_ITEM_GLYPH_SIZES: Readonly<
  Record<ExplorerItemVisualSize, number | string>
> = {
  fill: "100%",
  inline: 16,
  summary: 32,
};

export function renderExplorerItemVisual(
  ctx: {
    avatarUrlByLocalId: AvatarUrlById;
    row: ContainerItemRow;
  },
  size: ExplorerItemVisualSize,
): ReactNode {
  const { row } = ctx;
  const itemIcon = getExplorerItemIcon(row);
  const ItemIcon = itemIcon.Icon;
  const avatar = getExplorerDocumentAvatar(row, ctx.avatarUrlByLocalId);

  return avatar ? (
    // DocumentAvatarImage owns both the image and the kind's no-avatar glyph.
    // It also shrink-proofs itself without the generic glyph opacity.
    <DocumentAvatarImage
      fallbackIcon={avatar.fallbackIcon}
      imageUrl={avatar.imageUrl}
      size={size === "inline" ? "small" : "medium"}
    />
  ) : (
    <ItemIcon
      aria-hidden="true"
      className="explorer-item-icon"
      data-container-icon={itemIcon.containerIcon ?? undefined}
      data-icon={itemIcon.name}
      focusable="false"
      size={EXPLORER_ITEM_GLYPH_SIZES[size]}
      weight="regular"
    />
  );
}

/**
 * A table row's visual: the dense size for its layout, or — in large rows —
 * the shared large-row square, which takes its size from the frame's view.
 */
export function renderExplorerItemRowVisual(
  ctx: {
    avatarUrlByLocalId: AvatarUrlById;
    largeRows: boolean;
    row: ContainerItemRow;
  },
  size: Exclude<ExplorerItemVisualSize, "fill">,
): ReactNode {
  return ctx.largeRows ? (
    <MiniAppItemThumb>{renderExplorerItemVisual(ctx, "fill")}</MiniAppItemThumb>
  ) : (
    renderExplorerItemVisual(ctx, size)
  );
}

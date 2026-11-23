import type { Icon } from "@phosphor-icons/react";
import type { ContainerItemRow } from "@tearleads/client-sdk";
import type { ReactNode } from "react";
import { MiniAppItemThumb } from "../../../../components/mini-app/item-view/MiniAppItemThumb";
import { ContactAvatar } from "../../../../document-types/contact/ContactAvatar";
import type { AvatarUrlByContactId } from "../../../../document-types/contact/useContactAvatarUrls";
import { getDocumentTypeIcon } from "../../../../document-types/registry";
import { getViewerRelativeContactDocumentLabel } from "../../../../stores/contacts/contactLabels";
import { getExplorerContactAvatar } from "../../shared/explorerContactAvatar";
import { getExplorerContainerIcon } from "../../shared/explorerContainerIcons";

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
    contactAvatarUrlByLocalId: AvatarUrlByContactId;
    row: ContainerItemRow;
  },
  size: ExplorerItemVisualSize,
): ReactNode {
  const { row } = ctx;
  const itemIcon = getExplorerItemIcon(row);
  const ItemIcon = itemIcon.Icon;
  const contactAvatar =
    row.itemKind === "document"
      ? getExplorerContactAvatar(
          row.documentKind,
          row.localId,
          ctx.contactAvatarUrlByLocalId,
        )
      : null;

  return contactAvatar ? (
    // ContactAvatar owns both the image and the shared no-avatar silhouette.
    // It also shrink-proofs itself without the generic glyph opacity.
    <ContactAvatar
      imageUrl={contactAvatar.imageUrl}
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
    contactAvatarUrlByLocalId: AvatarUrlByContactId;
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

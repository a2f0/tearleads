import type { Icon } from "@phosphor-icons/react";
import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { ImagesIcon } from "@phosphor-icons/react/dist/csr/Images";
import { PlaylistIcon } from "@phosphor-icons/react/dist/csr/Playlist";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";

interface ExplorerContainerIcon {
  readonly Component: Icon;
  readonly containerIcon: string;
  readonly name: string;
}

// The container icons a user may pick for a folder they administer. The default
// folder is represented as null in the metadata document (see
// toStoredContainerIcon), so "folder" here is the picker's stand-in for "unset".
export type SelectableContainerIconSlug = "album" | "folder" | "playlist";

export const SELECTABLE_CONTAINER_ICON_SLUGS: readonly SelectableContainerIconSlug[] =
  ["folder", "playlist", "album"];

// Map a stored container icon value to the slug shown in the picker. Unset or
// unrecognized icons (including containers without a stored icon and
// app-managed slots) fall back to the default folder.
export function toSelectableContainerIconSlug(
  icon: string | null | undefined,
): SelectableContainerIconSlug {
  const normalized = icon?.trim();
  if (normalized === "playlist" || normalized === "album") {
    return normalized;
  }
  return "folder";
}

// Convert a picked slug into the value persisted in container metadata. The
// default folder is stored as null (unset) so it matches containers without a
// stored icon and avoids a redundant metadata write when nothing effectively
// changed.
export function toStoredContainerIcon(
  slug: SelectableContainerIconSlug,
): string | null {
  return slug === "folder" ? null : slug;
}

export function getExplorerContainerIcon(params: {
  icon: string | null | undefined;
  isOpen: boolean;
}): ExplorerContainerIcon {
  const containerIcon = params.icon?.trim() || "folder";

  if (containerIcon === "trash") {
    return {
      Component: TrashIcon,
      containerIcon,
      name: "trash",
    };
  }

  if (containerIcon === "contacts") {
    return {
      Component: AddressBookIcon,
      containerIcon,
      name: "contacts",
    };
  }

  if (containerIcon === "playlist") {
    return {
      Component: PlaylistIcon,
      containerIcon,
      name: "playlist",
    };
  }

  if (containerIcon === "album") {
    return {
      Component: ImagesIcon,
      containerIcon,
      name: "album",
    };
  }

  return {
    Component: params.isOpen ? FolderOpenIcon : FolderIcon,
    containerIcon,
    name: params.isOpen ? "folder-open" : "folder",
  };
}

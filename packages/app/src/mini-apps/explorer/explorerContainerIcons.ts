import type { Icon } from "@phosphor-icons/react";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";

interface ExplorerContainerIcon {
  readonly Component: Icon;
  readonly containerIcon: string;
  readonly name: string;
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

  return {
    Component: params.isOpen ? FolderOpenIcon : FolderIcon,
    containerIcon,
    name: params.isOpen ? "folder-open" : "folder",
  };
}

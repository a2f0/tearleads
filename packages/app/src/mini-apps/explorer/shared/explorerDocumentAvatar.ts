import type { Icon } from "@phosphor-icons/react";
import type { ContainerItemRow } from "@tearleads/client-sdk";
import { useMemo } from "react";
import { getDocumentPhotoCapability } from "../../../document-types/registry";
import type {
  AvatarDocument,
  DocumentAvatarSource,
} from "../../../document-types/shared/avatar/documentAvatarSource";
import type { AvatarUrlById } from "../../../document-types/shared/avatar/useAvatarUrls";
import { useDocumentAvatarUrls } from "../../../document-types/shared/avatar/useDocumentAvatarUrls";

interface ExplorerDocumentAvatar {
  fallbackIcon: Icon;
  imageUrl: string | undefined;
}

// A document whose kind keeps a photo gallery lists as its avatar: the chosen
// photo, or the kind's fallback glyph in the same circle until one is chosen
// or loaded. Other documents and containers list with their plain glyph.
export function getExplorerDocumentAvatar(
  row: ContainerItemRow,
  avatarUrlByLocalId: AvatarUrlById,
): ExplorerDocumentAvatar | null {
  if (row.itemKind !== "document") {
    return null;
  }

  const photos = getDocumentPhotoCapability(row.documentKind);
  return photos
    ? {
        fallbackIcon: photos.avatarFallbackIcon,
        imageUrl: avatarUrlByLocalId[row.localId],
      }
    : null;
}

function getExplorerAvatarDocuments(
  rows: ReadonlyArray<ContainerItemRow>,
): ReadonlyArray<AvatarDocument> {
  const documentsByLocalId = new Map<string, AvatarDocument>();
  for (const row of rows) {
    if (row.itemKind !== "document") {
      continue;
    }

    // A linked document lists once per container but has one avatar.
    const photos = getDocumentPhotoCapability(row.documentKind);
    if (photos && !documentsByLocalId.has(row.localId)) {
      documentsByLocalId.set(row.localId, {
        documentKind: row.documentKind,
        localId: row.localId,
        photos,
      });
    }
  }

  return [...documentsByLocalId.values()];
}

/** Avatar URLs for the loaded window of the item list, keyed by local id. */
export function useExplorerItemAvatarUrls(
  source: DocumentAvatarSource | null,
  rows: ReadonlyArray<ContainerItemRow>,
): AvatarUrlById {
  const documents = useMemo(() => getExplorerAvatarDocuments(rows), [rows]);
  return useDocumentAvatarUrls(source, documents);
}

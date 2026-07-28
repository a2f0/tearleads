import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { exportAllUpdates, importUpdates } from "@tearleads/loro";
import { readContainerMetadataValue } from "../../../data/containers/containerMetadataDocument";
import type { ContainerMetadataRecord } from "../containerPersistence";
import type { ContainerMetadataDocumentState } from "./types";

export interface ReattachedContainerMetadata {
  icon: string | null;
  initialSnapshot: string;
  name: string;
}

/**
 * Resolve a freshly discovered container's metadata content against dormant
 * retained state (docs/sync-edge-cases.md row 4, access_revoked branch). A
 * dormant record makes this a re-attach: its content is imported into the
 * live document and projected, so a queued local rename or icon edit renders
 * immediately instead of a default name until sync succeeds. Without one, the
 * document seeds fresh with the default projection.
 */
export function reattachDormantContainerMetadata(input: {
  defaultName: string;
  doc: ContainerMetadataDocumentState;
  dormantRecord: ContainerMetadataRecord | null;
}): ReattachedContainerMetadata {
  const { defaultName, doc, dormantRecord } = input;
  if (!dormantRecord?.metadataUpdates) {
    return {
      icon: null,
      initialSnapshot: bytesToBase64(exportAllUpdates(doc)),
      name: defaultName,
    };
  }

  importUpdates(doc, [base64ToBytes(dormantRecord.metadataUpdates)]);
  const metadata = readContainerMetadataValue(doc, defaultName);
  return {
    icon: metadata.icon,
    initialSnapshot: dormantRecord.metadataUpdates,
    name: metadata.name,
  };
}

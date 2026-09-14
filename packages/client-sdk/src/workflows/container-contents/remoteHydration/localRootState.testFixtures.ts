import { createContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import type { ContainerState } from "./types";

/** A pre-login local root: no remote identity, no organization. */
export async function localOnlyRootState(id: string): Promise<ContainerState> {
  return {
    container: {
      effectiveAccessLevel: "admin",
      icon: null,
      id,
      metadataDocumentId: null,
      name: "/",
      organizationId: "",
      parentId: null,
      systemSlot: null,
    },
    doc: await createContainerMetadataDocument(id),
    record: {
      accessEpoch: 1,
      accessStateHash: null,
      contentKeyBundle: null,
      documentId: null,
      documentKekTargets: null,
      documentManifestBundle: null,
      id,
      lastCommitLsn: null,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  };
}

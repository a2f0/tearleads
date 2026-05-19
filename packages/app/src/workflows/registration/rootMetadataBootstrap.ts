import { createInitializedContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";

export interface InitialRootMetadataBootstrap {
  initialUpdate: Uint8Array;
  metadataDocumentId: string;
}

export async function createInitialRootMetadataBootstrap(
  containerId: string,
): Promise<InitialRootMetadataBootstrap> {
  const metadataDocumentId = crypto.randomUUID();
  const { initialUpdate } = await createInitializedContainerMetadataDocument(
    containerId,
    {
      icon: null,
      name: "/",
    },
  );

  return {
    initialUpdate,
    metadataDocumentId,
  };
}

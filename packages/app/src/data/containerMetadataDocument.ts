import { createDocument, exportAllUpdates } from "@tearleads/loro";
import { getScopedPeerSeed } from "./crdtPeerSeed";

interface ContainerMetadataValue {
  icon: string | null;
  name: string;
}

type ContainerMetadataDocument = Awaited<ReturnType<typeof createDocument>>;

export async function createContainerMetadataDocument(
  containerId: string,
): Promise<ContainerMetadataDocument> {
  return createDocument(getScopedPeerSeed(`container-metadata:${containerId}`));
}

export async function createInitializedContainerMetadataDocument(
  containerId: string,
  value: ContainerMetadataValue,
): Promise<{
  doc: ContainerMetadataDocument;
  initialUpdate: Uint8Array;
}> {
  const doc = await createContainerMetadataDocument(containerId);
  writeContainerMetadataValue(doc, value);

  return {
    doc,
    initialUpdate: exportAllUpdates(doc),
  };
}

export function readContainerMetadataValue(
  doc: ContainerMetadataDocument,
  fallbackName: string,
): ContainerMetadataValue {
  const metadata = doc.getMap("container");
  const storedName = metadata.get("name");
  const storedIcon = metadata.get("icon");

  return {
    icon:
      typeof storedIcon === "string" && storedIcon.length > 0
        ? storedIcon
        : null,
    name:
      typeof storedName === "string" && storedName.trim().length > 0
        ? storedName
        : fallbackName,
  };
}

export function writeContainerMetadataValue(
  doc: ContainerMetadataDocument,
  value: ContainerMetadataValue,
): void {
  const metadata = doc.getMap("container");

  metadata.set("name", value.name);

  if (value.icon) {
    metadata.set("icon", value.icon);
    return;
  }

  metadata.delete("icon");
}

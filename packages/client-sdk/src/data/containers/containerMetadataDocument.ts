import { createDocument, exportAllUpdates } from "@tearleads/loro";
import { getScopedPeerSeed } from "../crdtPeerSeed";

interface ContainerMetadataValue {
  icon: string | null;
  name: string;
}

export type ContainerMetadataDocument = Awaited<
  ReturnType<typeof createDocument>
>;

export function getDefaultContainerName(parentId: string | null): string {
  return parentId === null ? "/" : "Untitled";
}

export async function createContainerMetadataDocument(
  _containerId: string,
): Promise<ContainerMetadataDocument> {
  // A single static scope for all container-metadata docs: they are separate
  // CRDTs, so they can share one device peer, and a per-container scope would
  // hold a distinct device-peer lock (and cache entry) per container for the
  // tab's lifetime, accumulating without bound as containers are browsed.
  return createDocument(await getScopedPeerSeed("container-metadata"));
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
  defaultName: string,
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
        : defaultName,
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

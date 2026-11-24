import { createDocument, exportAllUpdates } from "@tearleads/loro";
import type { DomainScope } from "../../../data/shared/domainScope";
import {
  getRuntimePeerSeed,
  recordPeerSeed,
} from "../../../data/sync/crdtPeerSeed";
import {
  bindRuntimeMetadataWriterPeer,
  finishLocalMetadataWrite,
  prepareLocalMetadataWrite,
} from "./metadataWriterPeers";

interface ContainerMetadataValue {
  icon: string | null;
  name: string;
  primaryDocumentId?: string | null;
}

export type ContainerMetadataDocument = Awaited<
  ReturnType<typeof createDocument>
>;

export function getDefaultContainerName(parentId: string | null): string {
  return parentId === null ? "/" : "Untitled";
}

/** The runtime whose user writes a container's metadata. */
export interface ContainerMetadataWriter {
  readonly auth: { readonly userId: string | null };
  readonly state: {
    readonly domainScope: DomainScope;
    readonly peerScope?: string | null | undefined;
  };
}

const CONTAINER_METADATA_PEER_SCOPE = "container-metadata";

/**
 * A container's metadata document under the writer's peer for it: one per
 * container and user (`recordPeerSeed`), so another member cannot learn it
 * from this writer's other containers before it first commits here, and a
 * container a store reloads keeps writing under the same peer. The runtime
 * seed is per pane and runtime, as for documents, so two panes never write
 * one container under one peer. Every container shares that one seed scope,
 * because a per-container scope would hold a device-peer lock (and cache
 * entry) per container for the tab's lifetime, accumulating without bound as
 * containers are browsed.
 */
export async function createWriterContainerMetadataDocument(
  containerId: string,
  writer: ContainerMetadataWriter,
): Promise<ContainerMetadataDocument> {
  const peerScope = writer.state.peerScope;
  const scope = peerScope
    ? `${CONTAINER_METADATA_PEER_SCOPE}:${peerScope}`
    : CONTAINER_METADATA_PEER_SCOPE;
  const doc = await createDocument(
    recordPeerSeed({
      recordId: containerId,
      runtimeSeed: await getRuntimePeerSeed(scope, writer.state.domainScope),
      userId: writer.auth.userId,
    }),
  );
  bindRuntimeMetadataWriterPeer(doc, writer.state.domainScope);
  return doc;
}

/**
 * A metadata document under a fresh peer that is never reused: for a caller
 * that only reads stored metadata, a rebuild that drops local ops, which must
 * not reuse the live document's counters, and the base of a detached copy
 * (see `metadataWriterPeers.ts`).
 */
export function createContainerMetadataDocument(
  _containerId: string,
): Promise<ContainerMetadataDocument> {
  return createDocument(crypto.randomUUID());
}

/**
 * A new container's first metadata update. Its ops go under a fresh peer: a
 * create writes once, and no other member can know the peer before that
 * write commits and claims it. A caller that keeps editing `doc` keeps that
 * peer until it next loads the container.
 */
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
  const storedPrimary = metadata.get("primaryDocumentId");

  return {
    ...(typeof storedPrimary === "string" && storedPrimary.length > 0
      ? { primaryDocumentId: storedPrimary }
      : {}),
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
  value: Partial<ContainerMetadataValue>,
): void {
  prepareLocalMetadataWrite(doc);
  const metadata = doc.getMap("container");
  if (value.name !== undefined) metadata.set("name", value.name);
  for (const key of ["icon", "primaryDocumentId"] as const) {
    if (value[key] === undefined) continue;
    if (value[key]) metadata.set(key, value[key]);
    else metadata.delete(key);
  }
  finishLocalMetadataWrite(doc);
}

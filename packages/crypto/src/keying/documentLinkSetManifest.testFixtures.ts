import type {
  DocumentLinkSetManifestState,
  VerifiedAccessEvent,
  VerifiedDocumentLinkSetManifest,
} from "./index";
import {
  computeAccessManifestHash,
  deriveDocumentLinkSetManifest,
} from "./index";

export async function createDocumentLinkSetManifestFixture(input: {
  readonly documentId: string;
  readonly event: VerifiedAccessEvent;
  readonly linkedContainerIds: readonly string[];
  readonly organizationId: string;
  readonly previousManifestHash?: string | null;
  readonly epoch?: number;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId: input.documentId,
    organizationId: input.organizationId,
    epoch: input.epoch ?? 1,
    previousManifestHash: input.previousManifestHash ?? null,
    eventHash: input.event.eventHash,
    linkedContainerIds: [...input.linkedContainerIds].sort(),
  };
  const manifest = await deriveDocumentLinkSetManifest(state);

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    event: input.event,
    state,
  } as VerifiedDocumentLinkSetManifest;
}

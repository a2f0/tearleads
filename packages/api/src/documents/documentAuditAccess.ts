import type {
  KeyingCanonicalJson,
  VerifiedDocumentLinkSetManifest,
} from "@tearleads/crypto";
import { serializeKeyingCanonicalJson } from "@tearleads/crypto";
import { sha256Hex } from "../utils/sha256";

function documentLinkSetStateAuditRecord(
  state: VerifiedDocumentLinkSetManifest["state"],
): KeyingCanonicalJson {
  return {
    version: state.version,
    documentId: state.documentId,
    organizationId: state.organizationId,
    epoch: state.epoch,
    previousManifestHash: state.previousManifestHash,
    eventHash: state.eventHash,
    linkedContainerIds: [...state.linkedContainerIds],
  };
}

export async function documentAuditAccessFromManifest(
  manifest: VerifiedDocumentLinkSetManifest,
): Promise<{
  readonly accessEpoch: number;
  readonly accessManifestHash: string;
  readonly accessStateHash: string;
}> {
  return {
    accessEpoch: manifest.state.epoch,
    accessManifestHash: manifest.manifestHash,
    accessStateHash: sha256Hex(
      serializeKeyingCanonicalJson(
        documentLinkSetStateAuditRecord(manifest.state),
      ),
    ),
  };
}

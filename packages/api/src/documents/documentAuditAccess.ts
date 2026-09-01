import type { VerifiedDocumentLinkSetManifest } from "@tearleads/crypto";
import { serializeKeyingCanonicalJson } from "@tearleads/crypto";
import { documentLinkSetStateRecord } from "../keyingProjectionRecords";
import { sha256Hex } from "../utils/sha256";

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
      serializeKeyingCanonicalJson(documentLinkSetStateRecord(manifest.state)),
    ),
  };
}

import { serializeKeyingCanonicalJson } from "@tearleads/crypto";
import { documentContentRecordDerivationPayload } from "./contentRecordKeys";
import { DOCUMENT_CONTENT_RECORD_AAD_DOMAIN, TEXT_ENCODER } from "./types";

export function contentRecordAdditionalDataBytes(input: {
  contentKeyEpoch: number;
  contentRecordId: string;
  documentId: string;
  metadataHash: string;
  nonceDomainHash: string;
  organizationId: string;
}): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      domain: DOCUMENT_CONTENT_RECORD_AAD_DOMAIN,
      payload: {
        ...documentContentRecordDerivationPayload(input),
        metadataHash: input.metadataHash,
        nonceDomainHash: input.nonceDomainHash,
      },
    }),
  );
}

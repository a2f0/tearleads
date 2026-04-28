export const DEFAULT_DOCUMENT_ACCESS_EPOCH = 1;
const DOCUMENT_V2_SIGNER_DEVICE_ID_PREFIX = "signing-key:";

export function createDocumentV2SignerDeviceId(
  signingFingerprint: string,
): string {
  return `${DOCUMENT_V2_SIGNER_DEVICE_ID_PREFIX}${signingFingerprint}`;
}

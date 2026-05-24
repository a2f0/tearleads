export const DEFAULT_DOCUMENT_ACCESS_EPOCH = 1;
export const DEFAULT_DOCUMENT_KIND = "note";
const DOCUMENT_SIGNER_DEVICE_ID_PREFIX = "signing-key:";

export function createDocumentSignerDeviceId(
  signingFingerprint: string,
): string {
  return `${DOCUMENT_SIGNER_DEVICE_ID_PREFIX}${signingFingerprint}`;
}

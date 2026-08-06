export const DEFAULT_DOCUMENT_ACCESS_EPOCH = 1;
export const DEFAULT_DOCUMENT_KIND = "note";
// SDK-owned structured kind: the organization profile document every
// registration provisions. Homed in the data layer (like the "note" kind)
// so the projector registry can give it a stable untitled title on hosts
// that never register a projector for it.
export const ORGANIZATION_PROFILE_DOCUMENT_KIND = "organization_profile";
const DOCUMENT_SIGNER_DEVICE_ID_PREFIX = "signing-key:";

export function createDocumentSignerDeviceId(
  signingFingerprint: string,
): string {
  return `${DOCUMENT_SIGNER_DEVICE_ID_PREFIX}${signingFingerprint}`;
}

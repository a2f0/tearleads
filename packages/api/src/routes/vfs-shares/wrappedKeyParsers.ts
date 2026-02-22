import type {
  VfsOrgWrappedKeyPayload,
  VfsWrappedKeyPayload
} from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';

export function parseWrappedKeyPayload(
  value: unknown
): VfsWrappedKeyPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const recipientUserId = value['recipientUserId'];
  const recipientPublicKeyId = value['recipientPublicKeyId'];
  const keyEpoch = value['keyEpoch'];
  const encryptedKey = value['encryptedKey'];
  const senderSignature = value['senderSignature'];

  if (
    typeof recipientUserId !== 'string' ||
    typeof recipientPublicKeyId !== 'string' ||
    typeof keyEpoch !== 'number' ||
    !Number.isInteger(keyEpoch) ||
    !Number.isSafeInteger(keyEpoch) ||
    keyEpoch < 1 ||
    typeof encryptedKey !== 'string' ||
    typeof senderSignature !== 'string'
  ) {
    return null;
  }

  if (
    !recipientUserId.trim() ||
    !recipientPublicKeyId.trim() ||
    !encryptedKey.trim() ||
    !senderSignature.trim()
  ) {
    return null;
  }

  return {
    recipientUserId: recipientUserId.trim(),
    recipientPublicKeyId: recipientPublicKeyId.trim(),
    keyEpoch,
    encryptedKey: encryptedKey.trim(),
    senderSignature: senderSignature.trim()
  };
}

export function parseOrgWrappedKeyPayload(
  value: unknown
): VfsOrgWrappedKeyPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const recipientOrgId = value['recipientOrgId'];
  const recipientPublicKeyId = value['recipientPublicKeyId'];
  const keyEpoch = value['keyEpoch'];
  const encryptedKey = value['encryptedKey'];
  const senderSignature = value['senderSignature'];

  if (
    typeof recipientOrgId !== 'string' ||
    typeof recipientPublicKeyId !== 'string' ||
    typeof keyEpoch !== 'number' ||
    !Number.isInteger(keyEpoch) ||
    !Number.isSafeInteger(keyEpoch) ||
    keyEpoch < 1 ||
    typeof encryptedKey !== 'string' ||
    typeof senderSignature !== 'string'
  ) {
    return null;
  }

  if (
    !recipientOrgId.trim() ||
    !recipientPublicKeyId.trim() ||
    !encryptedKey.trim() ||
    !senderSignature.trim()
  ) {
    return null;
  }

  return {
    recipientOrgId: recipientOrgId.trim(),
    recipientPublicKeyId: recipientPublicKeyId.trim(),
    keyEpoch,
    encryptedKey: encryptedKey.trim(),
    senderSignature: senderSignature.trim()
  };
}

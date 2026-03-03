import type {
  VfsOrgWrappedKeyPayload,
  VfsWrappedKeyPayload
} from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';

interface WrappedKeyParts {
  recipientId: string;
  recipientPublicKeyId: string;
  keyEpoch: number;
  encryptedKey: string;
  senderSignature: string;
}

function parseWrappedKeyParts(
  value: unknown,
  recipientKey: 'recipientUserId' | 'recipientOrgId'
): WrappedKeyParts | null {
  if (!isRecord(value)) {
    return null;
  }

  const recipientId = value[recipientKey];
  const recipientPublicKeyId = value['recipientPublicKeyId'];
  const keyEpoch = value['keyEpoch'];
  const encryptedKey = value['encryptedKey'];
  const senderSignature = value['senderSignature'];

  if (
    typeof recipientId !== 'string' ||
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
    !recipientId.trim() ||
    !recipientPublicKeyId.trim() ||
    !encryptedKey.trim() ||
    !senderSignature.trim()
  ) {
    return null;
  }

  return {
    recipientId: recipientId.trim(),
    recipientPublicKeyId: recipientPublicKeyId.trim(),
    keyEpoch,
    encryptedKey: encryptedKey.trim(),
    senderSignature: senderSignature.trim()
  };
}

export function parseWrappedKeyPayload(
  value: unknown
): VfsWrappedKeyPayload | null {
  const parts = parseWrappedKeyParts(value, 'recipientUserId');
  if (!parts) {
    return null;
  }

  return {
    recipientUserId: parts.recipientId,
    recipientPublicKeyId: parts.recipientPublicKeyId,
    keyEpoch: parts.keyEpoch,
    encryptedKey: parts.encryptedKey,
    senderSignature: parts.senderSignature
  };
}

export function parseOrgWrappedKeyPayload(
  value: unknown
): VfsOrgWrappedKeyPayload | null {
  const parts = parseWrappedKeyParts(value, 'recipientOrgId');
  if (!parts) {
    return null;
  }

  return {
    recipientOrgId: parts.recipientId,
    recipientPublicKeyId: parts.recipientPublicKeyId,
    keyEpoch: parts.keyEpoch,
    encryptedKey: parts.encryptedKey,
    senderSignature: parts.senderSignature
  };
}

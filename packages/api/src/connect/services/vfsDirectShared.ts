import type {
  VfsKeySetupRequest,
  VfsObjectType,
  VfsRegisterRequest,
  VfsRekeyRequest
} from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';

const VALID_OBJECT_TYPES: VfsObjectType[] = [
  'file',
  'photo',
  'audio',
  'video',
  'contact',
  'note',
  'email',
  'mlsMessage',
  'conversation',
  'folder',
  'playlist',
  'album',
  'contactGroup',
  'tag'
];

type RekeyReason = 'unshare' | 'expiry' | 'manual';

function isValidObjectType(value: unknown): value is VfsObjectType {
  return (
    typeof value === 'string' &&
    VALID_OBJECT_TYPES.includes(value as VfsObjectType)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidRekeyReason(value: unknown): value is RekeyReason {
  return value === 'unshare' || value === 'expiry' || value === 'manual';
}

export function parseKeySetupPayload(body: unknown): VfsKeySetupRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const publicEncryptionKey = body['publicEncryptionKey'];
  const publicSigningKey = body['publicSigningKey'];
  const encryptedPrivateKeys = body['encryptedPrivateKeys'];
  const argon2Salt = body['argon2Salt'];

  if (
    typeof publicEncryptionKey !== 'string' ||
    (publicSigningKey != null && typeof publicSigningKey !== 'string') ||
    typeof encryptedPrivateKeys !== 'string' ||
    typeof argon2Salt !== 'string'
  ) {
    return null;
  }

  if (
    !publicEncryptionKey.trim() ||
    !encryptedPrivateKeys.trim() ||
    !argon2Salt.trim()
  ) {
    return null;
  }

  return {
    publicEncryptionKey: publicEncryptionKey.trim(),
    publicSigningKey:
      typeof publicSigningKey === 'string' ? publicSigningKey.trim() : '',
    encryptedPrivateKeys: encryptedPrivateKeys.trim(),
    argon2Salt: argon2Salt.trim()
  };
}

export function parseRegisterPayload(body: unknown): VfsRegisterRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const id = body['id'];
  const objectType = body['objectType'];
  const encryptedSessionKey = body['encryptedSessionKey'];
  const encryptedName = body['encryptedName'];

  if (
    typeof id !== 'string' ||
    !isValidObjectType(objectType) ||
    typeof encryptedSessionKey !== 'string'
  ) {
    return null;
  }

  if (!id.trim() || !encryptedSessionKey.trim()) {
    return null;
  }

  if (
    encryptedName !== undefined &&
    (typeof encryptedName !== 'string' || encryptedName.trim().length === 0)
  ) {
    return null;
  }

  return {
    id: id.trim(),
    objectType,
    encryptedSessionKey: encryptedSessionKey.trim(),
    ...(typeof encryptedName === 'string'
      ? { encryptedName: encryptedName.trim() }
      : {})
  };
}

export function parseRekeyPayload(body: unknown): VfsRekeyRequest | null {
  if (!isRecord(body)) {
    return null;
  }

  const reason = body['reason'];
  const newEpochValue = body['newEpoch'];
  const wrappedKeysValue = body['wrappedKeys'];

  if (
    !isValidRekeyReason(reason) ||
    typeof newEpochValue !== 'number' ||
    !Number.isInteger(newEpochValue) ||
    !Number.isSafeInteger(newEpochValue) ||
    newEpochValue < 1 ||
    !Array.isArray(wrappedKeysValue)
  ) {
    return null;
  }

  const wrappedKeys: VfsRekeyRequest['wrappedKeys'] = [];
  for (const wrappedKeyValue of wrappedKeysValue) {
    if (!isRecord(wrappedKeyValue)) {
      return null;
    }

    const recipientUserId = wrappedKeyValue['recipientUserId'];
    const recipientPublicKeyId = wrappedKeyValue['recipientPublicKeyId'];
    const keyEpochValue = wrappedKeyValue['keyEpoch'];
    const encryptedKey = wrappedKeyValue['encryptedKey'];
    const senderSignature = wrappedKeyValue['senderSignature'];

    if (
      !isNonEmptyString(recipientUserId) ||
      !isNonEmptyString(recipientPublicKeyId) ||
      typeof keyEpochValue !== 'number' ||
      !Number.isInteger(keyEpochValue) ||
      !Number.isSafeInteger(keyEpochValue) ||
      keyEpochValue < 1 ||
      !isNonEmptyString(encryptedKey) ||
      !isNonEmptyString(senderSignature)
    ) {
      return null;
    }

    if (keyEpochValue !== newEpochValue) {
      return null;
    }

    wrappedKeys.push({
      recipientUserId,
      recipientPublicKeyId,
      keyEpoch: keyEpochValue,
      encryptedKey,
      senderSignature
    });
  }

  return {
    reason,
    newEpoch: newEpochValue,
    wrappedKeys
  };
}

import type {
  VfsKeySetupRequest,
  VfsObjectType,
  VfsRegisterRequest
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
  'conversation',
  'folder',
  'playlist',
  'album',
  'contactGroup',
  'tag'
];

function isValidObjectType(value: unknown): value is VfsObjectType {
  return (
    typeof value === 'string' &&
    VALID_OBJECT_TYPES.includes(value as VfsObjectType)
  );
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

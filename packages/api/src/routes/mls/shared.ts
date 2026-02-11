/* istanbul ignore file */
import type {
  AckMlsWelcomeRequest,
  AddMlsMemberRequest,
  CreateMlsGroupRequest,
  MlsCipherSuite,
  MlsMessageType,
  RemoveMlsMemberRequest,
  SendMlsMessageRequest,
  UpdateMlsGroupRequest,
  UploadMlsKeyPackagesRequest,
  UploadMlsStateRequest
} from '@rapid/shared';
import { isRecord, MLS_CIPHERSUITES } from '@rapid/shared';

function isValidCipherSuite(value: unknown): value is MlsCipherSuite {
  return (
    typeof value === 'number' &&
    Object.values(MLS_CIPHERSUITES).includes(value as MlsCipherSuite)
  );
}

export function toSafeCipherSuite(value: unknown): MlsCipherSuite {
  return isValidCipherSuite(value)
    ? value
    : MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519;
}

function isValidMessageType(value: unknown): value is MlsMessageType {
  return (
    typeof value === 'string' &&
    ['application', 'commit', 'proposal'].includes(value)
  );
}

export function parseUploadKeyPackagesPayload(
  body: unknown
): UploadMlsKeyPackagesRequest | null {
  if (!isRecord(body)) return null;
  const keyPackages = body['keyPackages'];
  if (!Array.isArray(keyPackages)) return null;

  const parsed: UploadMlsKeyPackagesRequest['keyPackages'] = [];
  for (const kp of keyPackages) {
    if (!isRecord(kp)) return null;
    const keyPackageData = kp['keyPackageData'];
    const keyPackageRef = kp['keyPackageRef'];
    const cipherSuite = kp['cipherSuite'];

    if (
      typeof keyPackageData !== 'string' ||
      typeof keyPackageRef !== 'string' ||
      !isValidCipherSuite(cipherSuite)
    ) {
      return null;
    }

    if (!keyPackageData.trim() || !keyPackageRef.trim()) return null;

    parsed.push({
      keyPackageData: keyPackageData.trim(),
      keyPackageRef: keyPackageRef.trim(),
      cipherSuite
    });
  }

  if (parsed.length === 0) return null;
  return { keyPackages: parsed };
}

export function parseCreateGroupPayload(
  body: unknown
): CreateMlsGroupRequest | null {
  if (!isRecord(body)) return null;
  const name = body['name'];
  const description = body['description'];
  const groupIdMls = body['groupIdMls'];
  const cipherSuite = body['cipherSuite'];

  if (
    typeof name !== 'string' ||
    typeof groupIdMls !== 'string' ||
    !isValidCipherSuite(cipherSuite)
  ) {
    return null;
  }

  if (!name.trim() || !groupIdMls.trim()) return null;

  const result: CreateMlsGroupRequest = {
    name: name.trim(),
    groupIdMls: groupIdMls.trim(),
    cipherSuite
  };
  if (typeof description === 'string' && description.trim()) {
    result.description = description.trim();
  }
  return result;
}

export function parseUpdateGroupPayload(
  body: unknown
): UpdateMlsGroupRequest | null {
  if (!isRecord(body)) return null;
  const name = body['name'];
  const description = body['description'];

  const result: UpdateMlsGroupRequest = {};
  if (typeof name === 'string') result.name = name.trim();
  if (typeof description === 'string') result.description = description.trim();

  if (Object.keys(result).length === 0) return null;
  return result;
}

export function parseAddMemberPayload(
  body: unknown
): AddMlsMemberRequest | null {
  if (!isRecord(body)) return null;
  const userId = body['userId'];
  const commit = body['commit'];
  const welcome = body['welcome'];
  const keyPackageRef = body['keyPackageRef'];
  const newEpoch = body['newEpoch'];

  if (
    typeof userId !== 'string' ||
    typeof commit !== 'string' ||
    typeof welcome !== 'string' ||
    typeof keyPackageRef !== 'string' ||
    typeof newEpoch !== 'number'
  ) {
    return null;
  }

  if (
    !userId.trim() ||
    !commit.trim() ||
    !welcome.trim() ||
    !keyPackageRef.trim()
  ) {
    return null;
  }

  return {
    userId: userId.trim(),
    commit: commit.trim(),
    welcome: welcome.trim(),
    keyPackageRef: keyPackageRef.trim(),
    newEpoch
  };
}

export function parseRemoveMemberPayload(
  body: unknown
): RemoveMlsMemberRequest | null {
  if (!isRecord(body)) return null;
  const commit = body['commit'];
  const newEpoch = body['newEpoch'];

  if (typeof commit !== 'string' || typeof newEpoch !== 'number') {
    return null;
  }

  if (!commit.trim()) return null;

  return {
    commit: commit.trim(),
    newEpoch
  };
}

export function parseSendMessagePayload(
  body: unknown
): SendMlsMessageRequest | null {
  if (!isRecord(body)) return null;
  const ciphertext = body['ciphertext'];
  const epoch = body['epoch'];
  const messageType = body['messageType'];
  const contentType = body['contentType'];

  if (
    typeof ciphertext !== 'string' ||
    typeof epoch !== 'number' ||
    !isValidMessageType(messageType)
  ) {
    return null;
  }

  if (!ciphertext.trim()) return null;

  const result: SendMlsMessageRequest = {
    ciphertext: ciphertext.trim(),
    epoch,
    messageType
  };
  if (typeof contentType === 'string' && contentType.trim()) {
    result.contentType = contentType.trim();
  }
  return result;
}

export function parseUploadStatePayload(
  body: unknown
): UploadMlsStateRequest | null {
  if (!isRecord(body)) return null;
  const epoch = body['epoch'];
  const encryptedState = body['encryptedState'];
  const stateHash = body['stateHash'];

  if (
    typeof epoch !== 'number' ||
    typeof encryptedState !== 'string' ||
    typeof stateHash !== 'string'
  ) {
    return null;
  }

  if (!encryptedState.trim() || !stateHash.trim()) return null;

  return {
    epoch,
    encryptedState: encryptedState.trim(),
    stateHash: stateHash.trim()
  };
}

export function parseAckWelcomePayload(
  body: unknown
): AckMlsWelcomeRequest | null {
  if (!isRecord(body)) return null;
  const groupId = body['groupId'];

  if (typeof groupId !== 'string' || !groupId.trim()) return null;

  return { groupId: groupId.trim() };
}

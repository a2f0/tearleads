import type { VfsRekeyResponse } from '@tearleads/shared';
import type {
  RotateItemKeyEpochInput,
  RotateItemKeyEpochResult,
  VfsKeyManager
} from './keyManager';

export interface VfsRekeyApiClient {
  rekeyItem: (
    itemId: string,
    data: {
      reason: RotateItemKeyEpochInput['reason'];
      newEpoch: number;
      wrappedKeys: Array<{
        recipientUserId: string;
        recipientPublicKeyId: string;
        keyEpoch: number;
        encryptedKey: string;
        senderSignature: string;
      }>;
    }
  ) => Promise<VfsRekeyResponse>;
}

export interface RotateItemKeyEpochAndPersistInput {
  itemId: string;
  reason: RotateItemKeyEpochInput['reason'];
  keyManager: Pick<VfsKeyManager, 'rotateItemKeyEpoch'>;
  apiClient: VfsRekeyApiClient;
}

/**
 * Rotate a local item key epoch, then persist wrapped keys to the server.
 * Fails closed if server persistence fails.
 */
export async function rotateItemKeyEpochAndPersist(
  input: RotateItemKeyEpochAndPersistInput
): Promise<RotateItemKeyEpochResult> {
  const rotated = await input.keyManager.rotateItemKeyEpoch({
    itemId: input.itemId,
    reason: input.reason
  });

  await input.apiClient.rekeyItem(input.itemId, {
    reason: input.reason,
    newEpoch: rotated.newEpoch,
    wrappedKeys: rotated.wraps.map((wrap) => ({
      recipientUserId: wrap.recipientUserId,
      recipientPublicKeyId: wrap.recipientPublicKeyId,
      keyEpoch: wrap.keyEpoch,
      encryptedKey: wrap.encryptedKey,
      senderSignature: wrap.senderSignature
    }))
  });

  return rotated;
}

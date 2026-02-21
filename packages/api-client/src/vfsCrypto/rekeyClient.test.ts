import { describe, expect, it, vi } from 'vitest';
import { rotateItemKeyEpochAndPersist } from './rekeyClient';

describe('rotateItemKeyEpochAndPersist', () => {
  it('rotates locally and persists wrapped keys to API', async () => {
    const rotateItemKeyEpoch = vi.fn().mockResolvedValue({
      newEpoch: 2,
      wraps: [
        {
          recipientUserId: 'user-owner',
          recipientPublicKeyId: 'pk-owner',
          keyEpoch: 2,
          encryptedKey: 'enc-owner',
          senderSignature: 'sig-owner'
        },
        {
          recipientUserId: 'user-alice',
          recipientPublicKeyId: 'pk-alice',
          keyEpoch: 2,
          encryptedKey: 'enc-alice',
          senderSignature: 'sig-alice'
        }
      ]
    });
    const rekeyItem = vi.fn().mockResolvedValue({
      itemId: 'item-1',
      newEpoch: 2,
      wrapsApplied: 2
    });

    const result = await rotateItemKeyEpochAndPersist({
      itemId: 'item-1',
      reason: 'unshare',
      keyManager: {
        rotateItemKeyEpoch
      },
      apiClient: {
        rekeyItem
      }
    });

    expect(rotateItemKeyEpoch).toHaveBeenCalledWith({
      itemId: 'item-1',
      reason: 'unshare'
    });
    expect(rekeyItem).toHaveBeenCalledWith('item-1', {
      reason: 'unshare',
      newEpoch: 2,
      wrappedKeys: [
        {
          recipientUserId: 'user-owner',
          recipientPublicKeyId: 'pk-owner',
          keyEpoch: 2,
          encryptedKey: 'enc-owner',
          senderSignature: 'sig-owner'
        },
        {
          recipientUserId: 'user-alice',
          recipientPublicKeyId: 'pk-alice',
          keyEpoch: 2,
          encryptedKey: 'enc-alice',
          senderSignature: 'sig-alice'
        }
      ]
    });
    expect(result).toEqual({
      newEpoch: 2,
      wraps: [
        {
          recipientUserId: 'user-owner',
          recipientPublicKeyId: 'pk-owner',
          keyEpoch: 2,
          encryptedKey: 'enc-owner',
          senderSignature: 'sig-owner'
        },
        {
          recipientUserId: 'user-alice',
          recipientPublicKeyId: 'pk-alice',
          keyEpoch: 2,
          encryptedKey: 'enc-alice',
          senderSignature: 'sig-alice'
        }
      ]
    });
  });

  it('propagates API persistence failures', async () => {
    const rotateItemKeyEpoch = vi.fn().mockResolvedValue({
      newEpoch: 2,
      wraps: [
        {
          recipientUserId: 'user-owner',
          recipientPublicKeyId: 'pk-owner',
          keyEpoch: 2,
          encryptedKey: 'enc-owner',
          senderSignature: 'sig-owner'
        }
      ]
    });
    const rekeyItem = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(
      rotateItemKeyEpochAndPersist({
        itemId: 'item-1',
        reason: 'manual',
        keyManager: {
          rotateItemKeyEpoch
        },
        apiClient: {
          rekeyItem
        }
      })
    ).rejects.toThrow('network down');
    expect(rotateItemKeyEpoch).toHaveBeenCalledTimes(1);
    expect(rekeyItem).toHaveBeenCalledTimes(1);
  });
});

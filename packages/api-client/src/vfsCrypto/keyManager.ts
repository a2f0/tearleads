import type {
  Base64,
  Epoch,
  ItemId,
  UserId,
  VfsWrappedKey
} from './types';

export interface VfsKeySetupPayload {
  publicEncryptionKey: Base64;
  publicSigningKey: Base64;
  encryptedPrivateKeys: Base64;
  argon2Salt: Base64;
}

export interface CreateItemKeyInput {
  itemId: ItemId;
  parentItemId?: ItemId | null;
}

export interface CreateItemKeyResult {
  keyEpoch: Epoch;
  ownerWrappedKey: VfsWrappedKey;
  encryptedSessionKey: Base64;
}

export interface WrapItemKeyForShareInput {
  itemId: ItemId;
  recipientUserId: UserId;
  recipientPublicKey: Base64;
}

export interface RotateItemKeyEpochInput {
  itemId: ItemId;
  reason: 'unshare' | 'expiry' | 'manual';
}

export interface RotateItemKeyEpochResult {
  newEpoch: Epoch;
  wraps: VfsWrappedKey[];
}

export interface VfsKeyManager {
  ensureUserKeys(): Promise<VfsKeySetupPayload>;
  createItemKey(input: CreateItemKeyInput): Promise<CreateItemKeyResult>;
  wrapItemKeyForShare(input: WrapItemKeyForShareInput): Promise<VfsWrappedKey>;
  rotateItemKeyEpoch(
    input: RotateItemKeyEpochInput
  ): Promise<RotateItemKeyEpochResult>;
}

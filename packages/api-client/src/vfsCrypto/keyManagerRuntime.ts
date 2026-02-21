import {
  deserializePublicKey,
  generateRandomKey,
  type serializeEncapsulation,
  splitPublicKey,
  type VfsKeyPair,
  wrapKeyForRecipient
} from '@tearleads/shared';
import type {
  CreateItemKeyInput,
  CreateItemKeyResult,
  RotateItemKeyEpochInput,
  RotateItemKeyEpochResult,
  VfsKeyManager,
  VfsKeySetupPayload,
  WrapItemKeyForShareInput
} from './keyManager';
import type { Base64, Epoch, ItemId, VfsWrappedKey } from './types';

export interface ItemKeyRecord {
  itemId: ItemId;
  keyEpoch: Epoch;
  sessionKey: Uint8Array;
}

export interface ItemKeyStore {
  getItemKey(input: {
    itemId: ItemId;
    keyEpoch?: Epoch;
  }): Promise<ItemKeyRecord | null>;
  setItemKey(record: ItemKeyRecord): Promise<void>;
  getLatestKeyEpoch(itemId: ItemId): Promise<Epoch | null>;
  listItemShares(itemId: ItemId): Promise<
    Array<{
      recipientUserId: string;
      keyEpoch: Epoch;
    }>
  >;
}

export interface UserKeyProvider {
  getUserKeyPair(): Promise<VfsKeyPair>;
  getUserId(): Promise<string>;
  getPublicKeyId(): Promise<string>;
}

export interface RecipientPublicKeyResolver {
  resolvePublicKey(userId: string): Promise<{
    publicKeyId: string;
    publicEncryptionKey: string;
  } | null>;
}

export interface VfsKeyManagerRuntimeOptions {
  userKeyProvider: UserKeyProvider;
  itemKeyStore: ItemKeyStore;
  recipientPublicKeyResolver: RecipientPublicKeyResolver;
  createKeySetupPayload: () => Promise<VfsKeySetupPayload>;
}

export function createVfsKeyManager(
  options: VfsKeyManagerRuntimeOptions
): VfsKeyManager {
  return new DefaultVfsKeyManager(options);
}

class DefaultVfsKeyManager implements VfsKeyManager {
  private readonly userKeyProvider: UserKeyProvider;
  private readonly itemKeyStore: ItemKeyStore;
  private readonly recipientPublicKeyResolver: RecipientPublicKeyResolver;
  private readonly createKeySetupPayload: () => Promise<VfsKeySetupPayload>;

  constructor(options: VfsKeyManagerRuntimeOptions) {
    this.userKeyProvider = options.userKeyProvider;
    this.itemKeyStore = options.itemKeyStore;
    this.recipientPublicKeyResolver = options.recipientPublicKeyResolver;
    this.createKeySetupPayload = options.createKeySetupPayload;
  }

  async ensureUserKeys(): Promise<VfsKeySetupPayload> {
    return this.createKeySetupPayload();
  }

  async createItemKey(input: CreateItemKeyInput): Promise<CreateItemKeyResult> {
    // Ensure user keys are provisioned before creating item-level epochs.
    // This keeps first secure upload fail-closed when key bootstrap is missing.
    await this.ensureUserKeys();

    const existingEpoch = await this.itemKeyStore.getLatestKeyEpoch(
      input.itemId
    );
    const keyEpoch = existingEpoch !== null ? existingEpoch + 1 : 1;
    const sessionKey = await generateRandomKey();

    await this.itemKeyStore.setItemKey({
      itemId: input.itemId,
      keyEpoch,
      sessionKey
    });

    const userId = await this.userKeyProvider.getUserId();
    const publicKeyId = await this.userKeyProvider.getPublicKeyId();
    const userKeyPair = await this.userKeyProvider.getUserKeyPair();

    const ownerWrappedKey = await wrapSessionKeyForKeyPair(
      sessionKey,
      userId,
      publicKeyId,
      keyEpoch,
      userKeyPair
    );

    const encryptedSessionKey = ownerWrappedKey.encryptedKey;

    return {
      keyEpoch,
      ownerWrappedKey,
      encryptedSessionKey
    };
  }

  async wrapItemKeyForShare(
    input: WrapItemKeyForShareInput
  ): Promise<VfsWrappedKey> {
    const itemKey = await this.itemKeyStore.getItemKey({
      itemId: input.itemId,
      keyEpoch: input.keyEpoch
    });
    if (!itemKey) {
      throw new Error(
        `Item key not found for itemId=${input.itemId}, keyEpoch=${input.keyEpoch}`
      );
    }

    const recipientKey = await this.recipientPublicKeyResolver.resolvePublicKey(
      input.recipientUserId
    );
    if (!recipientKey) {
      throw new Error(
        `Public key not found for userId=${input.recipientUserId}`
      );
    }

    const publicKeyParts = splitPublicKey(input.recipientPublicKey);
    const publicKey = deserializePublicKey(publicKeyParts);

    const encapsulation = wrapKeyForRecipient(itemKey.sessionKey, publicKey);
    const encryptedKey = combineEncapsulationToBase64(encapsulation);

    const userKeyPair = await this.userKeyProvider.getUserKeyPair();
    const senderSignature = await signWrappedKey(
      encryptedKey,
      itemKey.keyEpoch,
      userKeyPair
    );

    return {
      recipientUserId: input.recipientUserId,
      recipientPublicKeyId: recipientKey.publicKeyId,
      keyEpoch: itemKey.keyEpoch,
      encryptedKey,
      senderSignature
    };
  }

  async rotateItemKeyEpoch(
    input: RotateItemKeyEpochInput
  ): Promise<RotateItemKeyEpochResult> {
    const existingEpoch = await this.itemKeyStore.getLatestKeyEpoch(
      input.itemId
    );
    if (existingEpoch === null) {
      throw new Error(`No existing key found for itemId=${input.itemId}`);
    }

    const newEpoch = existingEpoch + 1;
    const newSessionKey = await generateRandomKey();

    await this.itemKeyStore.setItemKey({
      itemId: input.itemId,
      keyEpoch: newEpoch,
      sessionKey: newSessionKey
    });

    const existingShares = await this.itemKeyStore.listItemShares(input.itemId);
    const wraps: VfsWrappedKey[] = [];

    const userId = await this.userKeyProvider.getUserId();
    const publicKeyId = await this.userKeyProvider.getPublicKeyId();
    const userKeyPair = await this.userKeyProvider.getUserKeyPair();

    const ownerWrap = await wrapSessionKeyForKeyPair(
      newSessionKey,
      userId,
      publicKeyId,
      newEpoch,
      userKeyPair
    );
    wraps.push(ownerWrap);

    for (const share of existingShares) {
      if (share.recipientUserId === userId) {
        continue;
      }
      const recipientKey =
        await this.recipientPublicKeyResolver.resolvePublicKey(
          share.recipientUserId
        );
      if (!recipientKey) {
        continue;
      }

      const publicKeyParts = splitPublicKey(recipientKey.publicEncryptionKey);
      const publicKey = deserializePublicKey(publicKeyParts);
      const encapsulation = wrapKeyForRecipient(newSessionKey, publicKey);
      const encryptedKey = combineEncapsulationToBase64(encapsulation);
      const senderSignature = await signWrappedKey(
        encryptedKey,
        newEpoch,
        userKeyPair
      );

      wraps.push({
        recipientUserId: share.recipientUserId,
        recipientPublicKeyId: recipientKey.publicKeyId,
        keyEpoch: newEpoch,
        encryptedKey,
        senderSignature
      });
    }

    return {
      newEpoch,
      wraps
    };
  }
}

export async function wrapSessionKeyForKeyPair(
  sessionKey: Uint8Array,
  userId: string,
  publicKeyId: string,
  keyEpoch: Epoch,
  keyPair: VfsKeyPair
): Promise<VfsWrappedKey> {
  const publicKey = {
    x25519PublicKey: keyPair.x25519PublicKey,
    mlKemPublicKey: keyPair.mlKemPublicKey
  };

  const encapsulation = wrapKeyForRecipient(sessionKey, publicKey);
  const encryptedKey = combineEncapsulationToBase64(encapsulation);
  const senderSignature = await signWrappedKey(encryptedKey, keyEpoch, keyPair);

  return {
    recipientUserId: userId,
    recipientPublicKeyId: publicKeyId,
    keyEpoch,
    encryptedKey,
    senderSignature
  };
}

function combineEncapsulationToBase64(
  encapsulation: ReturnType<typeof serializeEncapsulation>
): Base64 {
  return [
    encapsulation.x25519EphemeralPublic,
    encapsulation.mlKemCiphertext,
    encapsulation.nonce,
    encapsulation.ciphertext
  ].join('.');
}

async function signWrappedKey(
  encryptedKey: string,
  keyEpoch: Epoch,
  _keyPair: VfsKeyPair
): Promise<Base64> {
  const dataToSign = new TextEncoder().encode(
    JSON.stringify({
      encryptedKey,
      keyEpoch
    })
  );

  const hash = await crypto.subtle.digest('SHA-256', dataToSign);
  return toBase64(new Uint8Array(hash));
}

function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < data.length; index += chunkSize) {
    binary += String.fromCharCode(...data.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export type { VfsKeyManager };

import type { VfsWriteOrchestrator } from '../vfsWriteOrchestrator';
import type { VfsCryptoEngine } from './engine';
import { createVfsCryptoEngine, type ItemKeyResolver } from './engineRuntime';
import type { VfsKeySetupPayload } from './keyManager';
import type {
  ItemKeyStore,
  RecipientPublicKeyResolver,
  UserKeyProvider
} from './keyManagerRuntime';
import {
  createVfsKeyManager,
  wrapSessionKeyForKeyPair
} from './keyManagerRuntime';
import type { VfsSecureOrchestratorFacadeOptions } from './secureOrchestratorFacade';
import { createVfsSecureOrchestratorFacadeWithRuntime } from './secureOrchestratorFacade';
import type { VfsSecureOrchestratorFacade } from './secureWritePipeline';
import type { VfsSecureWritePipelineRuntimeOptions } from './secureWritePipelineRuntime';
import { createVfsSecureWritePipeline } from './secureWritePipelineRuntime';
import type { VfsWrappedKey } from './types';

export interface VfsSecurePipelineFactoryOptions {
  userKeyProvider: UserKeyProvider;
  itemKeyStore: ItemKeyStore;
  recipientPublicKeyResolver: RecipientPublicKeyResolver;
  createKeySetupPayload: () => Promise<VfsKeySetupPayload>;
  chunkSizeBytes?: number;
}

export interface VfsSecurePipelineBundle {
  engine: VfsCryptoEngine;
  keyManager: ReturnType<typeof createVfsKeyManager>;
  createFacade: (
    orchestrator: Pick<
      VfsWriteOrchestrator,
      | 'queueCrdtLocalOperationAndPersist'
      | 'queueBlobStageAndPersist'
      | 'queueBlobChunkAndPersist'
      | 'queueBlobManifestCommitAndPersist'
      | 'queueBlobAttachAndPersist'
    >,
    options?: VfsSecureOrchestratorFacadeOptions
  ) => VfsSecureOrchestratorFacade;
}

export function createVfsSecurePipelineBundle(
  options: VfsSecurePipelineFactoryOptions
): VfsSecurePipelineBundle {
  const keyResolver = createItemKeyResolverFromStore(options.itemKeyStore);

  const engine = createVfsCryptoEngine({ keyResolver });

  const keyManager = createVfsKeyManager({
    userKeyProvider: options.userKeyProvider,
    itemKeyStore: options.itemKeyStore,
    recipientPublicKeyResolver: options.recipientPublicKeyResolver,
    createKeySetupPayload: options.createKeySetupPayload
  });
  const inFlightKeyProvisioning = new Map<string, Promise<number>>();

  const createFacade = (
    orchestrator: Pick<
      VfsWriteOrchestrator,
      | 'queueCrdtLocalOperationAndPersist'
      | 'queueBlobStageAndPersist'
      | 'queueBlobChunkAndPersist'
      | 'queueBlobManifestCommitAndPersist'
      | 'queueBlobAttachAndPersist'
    >,
    facadeOptions: VfsSecureOrchestratorFacadeOptions = {}
  ): VfsSecureOrchestratorFacade => {
    const runtimeOptions: VfsSecureWritePipelineRuntimeOptions = {
      engine,
      ...(options.chunkSizeBytes !== undefined && {
        chunkSizeBytes: options.chunkSizeBytes
      }),
      resolveKeyEpoch: async (itemId) => {
        const epoch = await options.itemKeyStore.getLatestKeyEpoch(itemId);
        if (epoch !== null) {
          return epoch;
        }
        const existingProvisioning = inFlightKeyProvisioning.get(itemId);
        if (existingProvisioning) {
          return existingProvisioning;
        }

        const provisionPromise = (async () => {
          const refreshedEpoch =
            await options.itemKeyStore.getLatestKeyEpoch(itemId);
          if (refreshedEpoch !== null) {
            return refreshedEpoch;
          }
          const result = await keyManager.createItemKey({ itemId });
          return result.keyEpoch;
        })();
        inFlightKeyProvisioning.set(itemId, provisionPromise);

        try {
          return await provisionPromise;
        } finally {
          inFlightKeyProvisioning.delete(itemId);
        }
      },
      listWrappedFileKeys: async ({ itemId, keyEpoch }) => {
        const wrappedKeys: VfsWrappedKey[] = [];

        // Include owner's wrapped key
        const userKeyPair = await options.userKeyProvider.getUserKeyPair();
        const userId = await options.userKeyProvider.getUserId();
        const publicKeyId = await options.userKeyProvider.getPublicKeyId();
        const itemKey = await options.itemKeyStore.getItemKey({
          itemId,
          keyEpoch
        });
        if (itemKey) {
          const ownerWrap = await wrapSessionKeyForKeyPair(
            itemKey.sessionKey,
            userId,
            publicKeyId,
            keyEpoch,
            userKeyPair
          );
          wrappedKeys.push(ownerWrap);
        }

        // Wrap key for each share recipient
        const shares = await options.itemKeyStore.listItemShares(itemId);
        for (const share of shares) {
          if (share.keyEpoch !== keyEpoch) {
            continue;
          }
          // Skip if this share is for the owner (already included above)
          if (share.recipientUserId === userId) {
            continue;
          }
          const recipientKey =
            await options.recipientPublicKeyResolver.resolvePublicKey(
              share.recipientUserId
            );
          if (!recipientKey) {
            continue;
          }
          const wrappedKey = await keyManager.wrapItemKeyForShare({
            itemId,
            recipientUserId: share.recipientUserId,
            recipientPublicKey: recipientKey.publicEncryptionKey,
            keyEpoch
          });
          wrappedKeys.push(wrappedKey);
        }

        return wrappedKeys;
      }
    };

    return createVfsSecureOrchestratorFacadeWithRuntime(
      orchestrator,
      runtimeOptions,
      facadeOptions
    );
  };

  return {
    engine,
    keyManager,
    createFacade
  };
}

function createItemKeyResolverFromStore(
  itemKeyStore: ItemKeyStore
): ItemKeyResolver {
  return {
    getItemKey: async ({
      itemId,
      keyEpoch
    }: {
      itemId: string;
      keyEpoch: number;
    }) => {
      const record = await itemKeyStore.getItemKey({ itemId, keyEpoch });
      if (!record) {
        throw new Error(
          `Item key not found for itemId=${itemId}, keyEpoch=${keyEpoch}`
        );
      }
      return record.sessionKey;
    }
  };
}

export { createVfsSecureWritePipeline, createVfsCryptoEngine };

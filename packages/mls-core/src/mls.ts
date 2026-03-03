/**
 * MLS client wrapper.
 *
 * All group, commit, and application-message primitives are delegated to the
 * Rust/WASM backend. The TypeScript layer handles persistence and orchestration.
 */

import {
  type MlsBackendStatus,
  resolveMlsBackendStatus
} from './mlsWasmBackend.js';
import {
  membersToLeafIndexMap,
  wasmAddMember,
  wasmCreateGroup,
  wasmDecryptMessage,
  wasmEncryptMessage,
  wasmExportGroupState,
  wasmGenerateCredential,
  wasmGenerateKeyPackage,
  wasmGroupStateMetadata,
  wasmImportGroupState,
  wasmJoinGroup,
  wasmProcessCommit,
  wasmRemoveMember
} from './mlsWasmBridge.js';
import { MlsStorage } from './storage.js';
import type { LocalKeyPackage, LocalMlsState, MlsCredential } from './types.js';

// Standard ciphersuite: MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519
export const MLS_CIPHERSUITE_NAME =
  'MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519';
export const MLS_CIPHERSUITE_ID = 0x0003;

interface KeyPackageWithRef {
  ref: string;
  keyPackageBytes: Uint8Array;
}

interface CommitResult {
  commit: Uint8Array;
  welcome?: Uint8Array;
  groupInfo?: Uint8Array;
  newEpoch?: number;
}

interface DecryptedContent {
  senderId: string;
  plaintext: Uint8Array;
  authenticatedData: Uint8Array;
}

interface GroupState {
  groupId: string;
  epoch: number;
  members: Map<string, number>; // userId -> leafIndex
  serialized: Uint8Array;
}

class MlsClientImpl {
  private storage: MlsStorage;
  private groupStates: Map<string, GroupState> = new Map();
  private credential: MlsCredential | null = null;
  private userId: string;
  private backendStatus: MlsBackendStatus = {
    backend: 'placeholder',
    wasmModuleLoaded: false,
    backendName: 'typescript-placeholder',
    backendVersion: null,
    productionReady: false,
    reason: 'MLS backend status not initialized yet.'
  };

  constructor(userId: string, storage?: MlsStorage) {
    this.userId = userId;
    this.storage = storage ?? new MlsStorage();
  }

  async init(): Promise<void> {
    await this.storage.init();

    this.backendStatus = await resolveMlsBackendStatus();

    if (!this.backendStatus.productionReady) {
      console.warn(`[mls-core] ${this.backendStatus.reason}`);
    }

    const storedCredential = await this.storage.getCredential(this.userId);
    if (storedCredential) {
      this.credential = storedCredential;
    }

    const groupStates = await this.storage.getAllGroupStates();
    for (const state of groupStates) {
      try {
        await this.installSerializedGroupState(
          state.groupId,
          state.serializedState,
          true
        );
      } catch {
        await this.storage.deleteGroupState(state.groupId);
      }
    }
  }

  async generateCredential(): Promise<MlsCredential> {
    this.assertBackendReady();

    const result = await wasmGenerateCredential(this.userId);

    const credential: MlsCredential = {
      credentialBundle: result.credentialBundle,
      privateKey: result.privateKey,
      userId: this.userId,
      createdAt: result.createdAtMs
    };

    await this.storage.saveCredential(credential);
    this.credential = credential;

    return credential;
  }

  async generateKeyPackage(): Promise<KeyPackageWithRef> {
    this.assertBackendReady();

    if (!this.credential) {
      throw new Error(
        'No credential available. Call generateCredential first.'
      );
    }

    const result = await wasmGenerateKeyPackage(
      this.credential.credentialBundle,
      this.credential.privateKey
    );

    const localKeyPackage: LocalKeyPackage = {
      ref: result.keyPackageRef,
      keyPackage: result.keyPackage,
      privateKey: result.privateKey,
      createdAt: result.createdAtMs
    };

    await this.storage.saveKeyPackage(localKeyPackage);

    return {
      ref: result.keyPackageRef,
      keyPackageBytes: result.keyPackage
    };
  }

  async createGroup(groupId: string): Promise<Uint8Array> {
    this.assertBackendReady();
    const credential = this.requireCredential();

    const state = await wasmCreateGroup(
      groupId,
      credential.credentialBundle,
      credential.privateKey
    );

    await this.installSerializedGroupState(groupId, state, true);
    return state;
  }

  async joinGroup(
    groupId: string,
    welcomeBytes: Uint8Array,
    keyPackageRef: string
  ): Promise<void> {
    this.assertBackendReady();
    const credential = this.requireCredential();

    const localKeyPackage = await this.storage.getKeyPackage(keyPackageRef);
    if (!localKeyPackage) {
      throw new Error(`Key package not found: ${keyPackageRef}`);
    }

    const state = await wasmJoinGroup(
      groupId,
      welcomeBytes,
      keyPackageRef,
      localKeyPackage.privateKey,
      credential.credentialBundle,
      credential.privateKey
    );

    await this.installSerializedGroupState(groupId, state, true);
    await this.storage.deleteKeyPackage(keyPackageRef);
  }

  async addMember(
    groupId: string,
    memberKeyPackageBytes: Uint8Array
  ): Promise<CommitResult> {
    this.assertBackendReady();
    const groupState = this.requireGroupState(groupId);

    const result = await wasmAddMember(
      groupState.serialized,
      memberKeyPackageBytes
    );

    await this.installSerializedGroupState(groupId, result.state, true);

    return {
      commit: result.commit,
      welcome: result.welcome,
      groupInfo: result.groupInfo,
      newEpoch: result.newEpoch
    };
  }

  async removeMember(
    groupId: string,
    leafIndex: number
  ): Promise<CommitResult> {
    this.assertBackendReady();
    const groupState = this.requireGroupState(groupId);

    const result = await wasmRemoveMember(groupState.serialized, leafIndex);

    await this.installSerializedGroupState(groupId, result.state, true);

    return {
      commit: result.commit,
      newEpoch: result.newEpoch
    };
  }

  async processCommit(groupId: string, commitBytes: Uint8Array): Promise<void> {
    this.assertBackendReady();
    const groupState = this.requireGroupState(groupId);

    const updatedState = await wasmProcessCommit(
      groupState.serialized,
      commitBytes
    );
    await this.installSerializedGroupState(groupId, updatedState, true);
  }

  async encryptMessage(
    groupId: string,
    plaintext: Uint8Array
  ): Promise<Uint8Array> {
    this.assertBackendReady();
    const groupState = this.requireGroupState(groupId);

    return wasmEncryptMessage(groupState.serialized, plaintext);
  }

  async decryptMessage(
    groupId: string,
    ciphertext: Uint8Array
  ): Promise<DecryptedContent> {
    this.assertBackendReady();
    const groupState = this.requireGroupState(groupId);

    const result = await wasmDecryptMessage(groupState.serialized, ciphertext);

    return {
      senderId: result.senderId,
      plaintext: result.plaintext,
      authenticatedData: result.authenticatedData
    };
  }

  async exportGroupState(groupId: string): Promise<Uint8Array> {
    this.assertBackendReady();
    const groupState = this.requireGroupState(groupId);
    return wasmExportGroupState(groupState.serialized);
  }

  async importGroupState(
    groupId: string,
    serializedState: Uint8Array
  ): Promise<void> {
    this.assertBackendReady();

    const normalized = await wasmImportGroupState(groupId, serializedState);
    await this.installSerializedGroupState(groupId, normalized.state, true);
  }

  getGroupEpoch(groupId: string): number | undefined {
    return this.groupStates.get(groupId)?.epoch;
  }

  getBackendStatus(): MlsBackendStatus {
    return this.backendStatus;
  }

  generateGroupIdMls(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return this.bytesToBase64(bytes);
  }

  hasGroup(groupId: string): boolean {
    return this.groupStates.has(groupId);
  }

  async leaveGroup(groupId: string): Promise<void> {
    this.groupStates.delete(groupId);
    await this.storage.deleteGroupState(groupId);
  }

  private requireCredential(): MlsCredential {
    if (!this.credential) {
      throw new Error(
        'No credential available. Call generateCredential first.'
      );
    }
    return this.credential;
  }

  private assertBackendReady(): void {
    if (!this.backendStatus.productionReady) {
      throw new Error(
        `MLS Rust/WASM backend is not ready: ${this.backendStatus.reason}`
      );
    }
  }

  private requireGroupState(groupId: string): GroupState {
    const groupState = this.groupStates.get(groupId);
    if (!groupState) {
      throw new Error(`Group not found: ${groupId}`);
    }
    return groupState;
  }

  private async installSerializedGroupState(
    groupId: string,
    serializedState: Uint8Array,
    persist: boolean
  ): Promise<void> {
    const metadata = await wasmGroupStateMetadata(serializedState);
    if (metadata.groupId !== groupId) {
      throw new Error(
        `Serialized state group mismatch: expected ${groupId}, got ${metadata.groupId}`
      );
    }

    const groupState: GroupState = {
      groupId,
      epoch: metadata.epoch,
      members: membersToLeafIndexMap(metadata),
      serialized: serializedState
    };

    this.groupStates.set(groupId, groupState);

    if (persist) {
      const localState: LocalMlsState = {
        groupId,
        serializedState,
        epoch: metadata.epoch,
        updatedAt: Date.now()
      };
      await this.storage.saveGroupState(localState);
    }
  }

  private bytesToBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode.apply(null, Array.from(bytes)));
  }

  close(): void {
    this.storage.close();
    this.groupStates.clear();
    this.credential = null;
  }
}

export type MlsClient = MlsClientImpl;
export const MlsClient = MlsClientImpl;
export type { MlsBackendStatus };

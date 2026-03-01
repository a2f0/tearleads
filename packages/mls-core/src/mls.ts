/**
 * MLS client wrapper.
 *
 * This is currently a placeholder implementation that provides the interface
 * that components expect. The encryption is simulated but not MLS-compliant.
 *
 * TODO: Integrate ts-mls library for real RFC 9420 MLS encryption.
 * The ciphersuite to use: MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519
 *
 * ts-mls integration requires:
 * - generateKeyPackage(credential, capabilities, lifetime, extensions, cipherSuite)
 * - createGroup(context, groupId, keyPackage, privateKeyPackage)
 * - joinGroup(context, welcome, keyPackage, privateKeys, ratchetTree?)
 * - createCommit(state, proposals)
 * - createApplicationMessage(context, state, message)
 * - processMessage(context, state, message)
 */

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

export class MlsClient {
  private storage: MlsStorage;
  private groupStates: Map<string, GroupState> = new Map();
  private credential: MlsCredential | null = null;
  private userId: string;

  constructor(userId: string, storage?: MlsStorage) {
    this.userId = userId;
    this.storage = storage ?? new MlsStorage();
  }

  async init(): Promise<void> {
    await this.storage.init();

    // Load existing credential if available
    const storedCredential = await this.storage.getCredential(this.userId);
    if (storedCredential) {
      this.credential = storedCredential;
    }

    // Load existing group states
    const groupStates = await this.storage.getAllGroupStates();
    for (const state of groupStates) {
      try {
        const groupState = this.deserializeGroupState(state.serializedState);
        this.groupStates.set(state.groupId, groupState);
      } catch {
        // Skip corrupted states
        await this.storage.deleteGroupState(state.groupId);
      }
    }
  }

  /**
   * Generate a new MLS credential for this user.
   */
  async generateCredential(): Promise<MlsCredential> {
    // Generate credential with user identity
    const credentialBundle = new TextEncoder().encode(this.userId);
    const privateKey = new Uint8Array(32);
    crypto.getRandomValues(privateKey);

    const mlsCredential: MlsCredential = {
      credentialBundle,
      privateKey,
      userId: this.userId,
      createdAt: Date.now()
    };

    await this.storage.saveCredential(mlsCredential);
    this.credential = mlsCredential;

    return mlsCredential;
  }

  /**
   * Generate a new key package for uploading to the server.
   */
  async generateKeyPackage(): Promise<KeyPackageWithRef> {
    if (!this.credential) {
      throw new Error(
        'No credential available. Call generateCredential first.'
      );
    }

    // Generate key package (placeholder - would use ts-mls in production)
    const keyPackage = new Uint8Array(128);
    const privateKey = new Uint8Array(32);
    const refBytes = new Uint8Array(32);

    crypto.getRandomValues(keyPackage);
    crypto.getRandomValues(privateKey);
    crypto.getRandomValues(refBytes);

    const ref = this.bytesToHex(refBytes);

    const localKeyPackage: LocalKeyPackage = {
      ref,
      keyPackage,
      privateKey,
      createdAt: Date.now()
    };

    await this.storage.saveKeyPackage(localKeyPackage);

    return {
      ref,
      keyPackageBytes: keyPackage
    };
  }

  /**
   * Create a new MLS group.
   */
  async createGroup(groupId: string): Promise<Uint8Array> {
    if (!this.credential) {
      throw new Error(
        'No credential available. Call generateCredential first.'
      );
    }

    const groupState: GroupState = {
      groupId,
      epoch: 0,
      members: new Map([[this.userId, 0]]),
      serialized: new Uint8Array(64)
    };

    crypto.getRandomValues(groupState.serialized);

    this.groupStates.set(groupId, groupState);
    await this.saveGroupState(groupId, groupState);

    return groupState.serialized;
  }

  /**
   * Join a group using a Welcome message.
   */
  async joinGroup(
    groupId: string,
    _welcomeBytes: Uint8Array,
    keyPackageRef: string
  ): Promise<void> {
    const localKeyPackage = await this.storage.getKeyPackage(keyPackageRef);
    if (!localKeyPackage) {
      throw new Error(`Key package not found: ${keyPackageRef}`);
    }

    const groupState: GroupState = {
      groupId,
      epoch: 1,
      members: new Map([[this.userId, 0]]),
      serialized: new Uint8Array(64)
    };

    crypto.getRandomValues(groupState.serialized);

    this.groupStates.set(groupId, groupState);
    await this.saveGroupState(groupId, groupState);

    // Remove consumed key package
    await this.storage.deleteKeyPackage(keyPackageRef);
  }

  /**
   * Add a member to a group.
   */
  async addMember(
    groupId: string,
    _memberKeyPackageBytes: Uint8Array
  ): Promise<CommitResult> {
    const groupState = this.groupStates.get(groupId);
    if (!groupState) {
      throw new Error(`Group not found: ${groupId}`);
    }

    // Update epoch
    groupState.epoch++;

    // Generate placeholder commit and welcome
    const commit = new Uint8Array(64);
    const welcome = new Uint8Array(128);
    const groupInfo = new Uint8Array(64);

    crypto.getRandomValues(commit);
    crypto.getRandomValues(welcome);
    crypto.getRandomValues(groupInfo);

    await this.saveGroupState(groupId, groupState);

    return {
      commit,
      welcome,
      groupInfo,
      newEpoch: groupState.epoch
    };
  }

  /**
   * Remove a member from a group.
   */
  async removeMember(
    groupId: string,
    _leafIndex: number
  ): Promise<CommitResult> {
    const groupState = this.groupStates.get(groupId);
    if (!groupState) {
      throw new Error(`Group not found: ${groupId}`);
    }

    // Update epoch
    groupState.epoch++;

    // Generate placeholder commit
    const commit = new Uint8Array(64);
    crypto.getRandomValues(commit);

    await this.saveGroupState(groupId, groupState);

    return { commit, newEpoch: groupState.epoch };
  }

  /**
   * Process a commit message received from another member.
   */
  async processCommit(
    groupId: string,
    _commitBytes: Uint8Array
  ): Promise<void> {
    const groupState = this.groupStates.get(groupId);
    if (!groupState) {
      throw new Error(`Group not found: ${groupId}`);
    }

    // Update epoch
    groupState.epoch++;
    await this.saveGroupState(groupId, groupState);
  }

  /**
   * Encrypt a message for a group.
   * Note: This is a placeholder - production would use ts-mls AEAD encryption.
   */
  async encryptMessage(
    groupId: string,
    plaintext: Uint8Array
  ): Promise<Uint8Array> {
    const groupState = this.groupStates.get(groupId);
    if (!groupState) {
      throw new Error(`Group not found: ${groupId}`);
    }

    // Placeholder: encode with a header containing metadata
    // Real implementation would use MLS AEAD encryption
    const header = new TextEncoder().encode(`MLS:${groupId}:${this.userId}:`);
    const ciphertext = new Uint8Array(header.length + plaintext.length);
    ciphertext.set(header, 0);
    ciphertext.set(plaintext, header.length);

    return ciphertext;
  }

  /**
   * Decrypt a message from a group.
   * Note: This is a placeholder - production would use ts-mls AEAD decryption.
   */
  async decryptMessage(
    groupId: string,
    ciphertext: Uint8Array
  ): Promise<DecryptedContent> {
    const groupState = this.groupStates.get(groupId);
    if (!groupState) {
      throw new Error(`Group not found: ${groupId}`);
    }

    // Placeholder: decode the format we used in encryptMessage
    const text = new TextDecoder().decode(ciphertext);
    const parts = text.split(':');

    const senderId = parts[2];
    if (parts.length >= 3 && parts[0] === 'MLS' && senderId) {
      const plaintext = new TextEncoder().encode(parts.slice(3).join(':'));

      return {
        senderId,
        plaintext,
        authenticatedData: new Uint8Array(0)
      };
    }

    // Fallback for messages we can't parse
    return {
      senderId: 'unknown',
      plaintext: ciphertext,
      authenticatedData: new Uint8Array(0)
    };
  }

  /**
   * Export group state for multi-device sync.
   */
  async exportGroupState(groupId: string): Promise<Uint8Array> {
    const groupState = this.groupStates.get(groupId);
    if (!groupState) {
      throw new Error(`Group not found: ${groupId}`);
    }

    return this.serializeGroupState(groupState);
  }

  /**
   * Import group state from another device.
   */
  async importGroupState(
    groupId: string,
    serializedState: Uint8Array
  ): Promise<void> {
    const groupState = this.deserializeGroupState(serializedState);
    groupState.groupId = groupId;
    this.groupStates.set(groupId, groupState);
    await this.saveGroupState(groupId, groupState);
  }

  /**
   * Get the current epoch for a group.
   */
  getGroupEpoch(groupId: string): number | undefined {
    return this.groupStates.get(groupId)?.epoch;
  }

  /**
   * Generate a base64 MLS group ID for server persistence.
   */
  generateGroupIdMls(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return this.bytesToBase64(bytes);
  }

  /**
   * Check if we have state for a group.
   */
  hasGroup(groupId: string): boolean {
    return this.groupStates.has(groupId);
  }

  /**
   * Leave a group (delete local state).
   */
  async leaveGroup(groupId: string): Promise<void> {
    this.groupStates.delete(groupId);
    await this.storage.deleteGroupState(groupId);
  }

  // Private helpers

  private async saveGroupState(
    groupId: string,
    groupState: GroupState
  ): Promise<void> {
    const serialized = this.serializeGroupState(groupState);
    const localState: LocalMlsState = {
      groupId,
      serializedState: serialized,
      epoch: groupState.epoch,
      updatedAt: Date.now()
    };
    await this.storage.saveGroupState(localState);
  }

  private serializeGroupState(groupState: GroupState): Uint8Array {
    const json = JSON.stringify({
      groupId: groupState.groupId,
      epoch: groupState.epoch,
      members: Array.from(groupState.members.entries()),
      serialized: Array.from(groupState.serialized),
      ciphersuite: MLS_CIPHERSUITE_ID
    });
    return new TextEncoder().encode(json);
  }

  private deserializeGroupState(bytes: Uint8Array): GroupState {
    const json = new TextDecoder().decode(bytes);
    const data = JSON.parse(json) as {
      groupId: string;
      epoch: number;
      members: Array<[string, number]>;
      serialized: number[];
      ciphersuite?: number;
    };

    return {
      groupId: data.groupId,
      epoch: data.epoch,
      members: new Map(data.members),
      serialized: new Uint8Array(data.serialized)
    };
  }

  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private bytesToBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode.apply(null, Array.from(bytes)));
  }

  /**
   * Clean up resources.
   */
  close(): void {
    this.storage.close();
    this.groupStates.clear();
    this.credential = null;
  }
}

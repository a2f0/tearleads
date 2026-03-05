import type { MlsGroupStateResponse } from '@tearleads/shared';
import { parseEnvelope, postMlsRpc } from './mlsConnectRpc.js';

interface GroupStateClient {
  hasGroup(groupId: string): boolean;
  importGroupState(groupId: string, serializedState: Uint8Array): Promise<void>;
  exportGroupState(groupId: string): Promise<Uint8Array>;
  getGroupEpoch(groupId: string): number | undefined;
}

interface GroupStateRequestContext {
  apiBaseUrl: string;
  getAuthHeader: (() => string | null) | undefined;
}

function bytesToBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < data.length; index += chunkSize) {
    binary += String.fromCharCode(...data.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const normalized = base64.trim();
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (bytesToBase64(bytes) !== normalized) {
    throw new Error('Invalid base64-encoded MLS group state');
  }
  return bytes;
}

async function sha256Base64(data: Uint8Array): Promise<string> {
  const normalized = new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', normalized.buffer);
  return bytesToBase64(new Uint8Array(digest));
}

export async function recoverMissingGroupState(input: {
  groupId: string;
  client: GroupStateClient;
  apiBaseUrl: string;
  getAuthHeader: (() => string | null) | undefined;
}): Promise<boolean> {
  if (input.client.hasGroup(input.groupId)) {
    return true;
  }

  const context: GroupStateRequestContext = {
    apiBaseUrl: input.apiBaseUrl,
    getAuthHeader: input.getAuthHeader
  };

  const response = await postMlsRpc(context, 'GetGroupState', {
    groupId: input.groupId
  });

  if (response.status === 404 || response.status === 403) {
    return false;
  }

  if (!response.ok) {
    throw new Error(`Failed to recover MLS group state for ${input.groupId}`);
  }

  const payload = parseEnvelope<MlsGroupStateResponse>(await response.json());
  if (!payload.state) {
    return false;
  }

  const serializedState = base64ToBytes(payload.state.encryptedState);
  const expectedStateHash = await sha256Base64(serializedState);
  if (expectedStateHash !== payload.state.stateHash) {
    throw new Error(
      `MLS group state hash mismatch for ${input.groupId}: expected ${payload.state.stateHash}, got ${expectedStateHash}`
    );
  }
  await input.client.importGroupState(input.groupId, serializedState);
  return true;
}

export async function uploadGroupStateSnapshot(input: {
  groupId: string;
  client: GroupStateClient;
  apiBaseUrl: string;
  getAuthHeader: (() => string | null) | undefined;
}): Promise<void> {
  if (!input.client.hasGroup(input.groupId)) {
    return;
  }

  const serializedState = await input.client.exportGroupState(input.groupId);
  const epoch = input.client.getGroupEpoch(input.groupId);
  if (epoch === undefined) {
    return;
  }

  const stateHash = await sha256Base64(serializedState);
  const context: GroupStateRequestContext = {
    apiBaseUrl: input.apiBaseUrl,
    getAuthHeader: input.getAuthHeader
  };

  const response = await postMlsRpc(context, 'UploadGroupState', {
    groupId: input.groupId,
    json: JSON.stringify({
      epoch,
      encryptedState: bytesToBase64(serializedState),
      stateHash
    })
  });

  if (response.status === 409) {
    return;
  }

  if (!response.ok) {
    throw new Error(`Failed to upload MLS group state for ${input.groupId}`);
  }
}

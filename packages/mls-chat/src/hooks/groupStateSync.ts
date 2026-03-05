import { Code, ConnectError } from '@connectrpc/connect';
import type { MlsV2Routes } from '@tearleads/api-client/mlsRoutes';

interface GroupStateClient {
  hasGroup(groupId: string): boolean;
  importGroupState(groupId: string, serializedState: Uint8Array): Promise<void>;
  exportGroupState(groupId: string): Promise<Uint8Array>;
  getGroupEpoch(groupId: string): number | undefined;
}

async function sha256Base64(data: Uint8Array): Promise<string> {
  const normalized = new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', normalized.buffer);
  let binary = '';
  const digestBytes = new Uint8Array(digest);
  const chunkSize = 0x8000;
  for (let index = 0; index < digestBytes.length; index += chunkSize) {
    binary += String.fromCharCode(
      ...digestBytes.subarray(index, index + chunkSize)
    );
  }
  return btoa(binary);
}

function isNotFoundOrForbidden(error: unknown): boolean {
  if (error instanceof ConnectError) {
    return error.code === Code.NotFound || error.code === Code.PermissionDenied;
  }
  return false;
}

function isConflict(error: unknown): boolean {
  if (error instanceof ConnectError) {
    return error.code === Code.AlreadyExists || error.code === Code.Aborted;
  }
  return false;
}

export async function recoverMissingGroupState(input: {
  groupId: string;
  client: GroupStateClient;
  mlsRoutes: MlsV2Routes;
}): Promise<boolean> {
  if (input.client.hasGroup(input.groupId)) {
    return true;
  }

  let payload: Awaited<ReturnType<MlsV2Routes['getGroupState']>>;
  try {
    payload = await input.mlsRoutes.getGroupState(input.groupId);
  } catch (error) {
    if (isNotFoundOrForbidden(error)) {
      return false;
    }
    throw error;
  }

  if (!payload.state) {
    return false;
  }

  const serializedState = payload.state.encryptedState;
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
  mlsRoutes: MlsV2Routes;
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

  try {
    await input.mlsRoutes.uploadGroupState(input.groupId, {
      epoch,
      encryptedState: serializedState,
      stateHash
    });
  } catch (error) {
    if (isConflict(error)) {
      return;
    }
    throw error;
  }
}

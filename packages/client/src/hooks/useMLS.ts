/**
 * useMLS - React hook for MLS (RFC 9420) encrypted chat operations
 *
 * This hook manages the MLS WASM worker and provides a React-friendly interface
 * for encrypted group chat operations including:
 * - Initializing MLS identity
 * - Generating KeyPackages
 * - Creating and joining groups
 * - Encrypting and decrypting messages
 *
 * Uses useSyncExternalStore for external state management with a singleton worker.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type {
  MlsWorkerRequestPayload,
  MlsWorkerResponse
} from '@/workers/mls-worker';

// Types for MLS state

export interface MlsGroupState {
  groupId: string;
  mlsGroupId: string;
  name: string;
}

export interface MlsKeyPackage {
  id: string;
  data: string;
}

export interface MlsState {
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  userId: string | null;
}

export interface UseMlsReturn extends MlsState {
  initialize: (userId: string) => Promise<void>;
  generateKeyPackages: (count: number) => Promise<MlsKeyPackage[]>;
  createGroup: (
    groupName: string
  ) => Promise<{ groupId: string; mlsGroupId: string }>;
  joinGroup: (
    welcomeData: string
  ) => Promise<{ groupId: string; mlsGroupId: string }>;
  addMembers: (
    groupId: string,
    keyPackages: string[]
  ) => Promise<{
    commit: string;
    welcomes: Array<{ keyPackageRef: string; welcome: string }>;
  }>;
  encrypt: (
    groupId: string,
    plaintext: string
  ) => Promise<{ ciphertext: string; epoch: number }>;
  decrypt: (
    groupId: string,
    ciphertext: string
  ) => Promise<{ plaintext: string; senderIndex: number } | null>;
  getEpoch: (groupId: string) => Promise<number>;
  exportState: () => Promise<unknown>;
}

// Mutable store for MLS state
const store: MlsState = {
  isInitialized: false,
  isLoading: false,
  error: null,
  userId: null
};

// Immutable snapshot for React
let snapshot: MlsState = { ...store };

// Pub-sub mechanism for useSyncExternalStore
const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function emitChange(): void {
  snapshot = { ...store };
  for (const listener of listeners) {
    listener();
  }
}

function getSnapshot(): MlsState {
  return snapshot;
}

// Singleton worker
let worker: Worker | null = null;

// Pending requests map keyed by requestId for concurrent request handling
interface PendingRequest {
  resolve: (value: MlsWorkerResponse) => void;
  reject: (error: Error) => void;
}
const pendingRequests = new Map<string, PendingRequest>();

// Counter for generating unique request IDs
let requestCounter = 0;

function generateRequestId(): string {
  return `req-${++requestCounter}-${Date.now()}`;
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/mls-worker.ts', import.meta.url), {
      type: 'module'
    });

    worker.onmessage = (event: MessageEvent<MlsWorkerResponse>) => {
      const response = event.data;
      const pending = pendingRequests.get(response.requestId);

      if (!pending) {
        console.warn('Received response for unknown request:', response);
        return;
      }

      pendingRequests.delete(response.requestId);

      if (response.type === 'error') {
        store.error = response.message;
        store.isLoading = false;
        emitChange();
        pending.reject(new Error(response.message));
        return;
      }

      if (response.type === 'initialized') {
        store.isInitialized = true;
        store.isLoading = false;
        store.error = null;
        emitChange();
      }

      pending.resolve(response);
    };

    worker.onerror = (error) => {
      console.error('MLS worker error:', error);
      store.error = error.message;
      store.isLoading = false;
      emitChange();

      // Reject all pending requests on worker error
      for (const [, pending] of pendingRequests) {
        pending.reject(new Error(error.message));
      }
      pendingRequests.clear();
    };
  }

  return worker;
}

/**
 * Send a request to the worker and wait for response
 * Each request gets a unique ID to handle concurrent operations safely
 */
async function sendRequest(
  request: MlsWorkerRequestPayload
): Promise<MlsWorkerResponse> {
  const w = getWorker();
  const requestId = generateRequestId();

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    w.postMessage({ ...request, requestId });
  });
}

/**
 * Reset MLS state when switching instances
 */
export function resetMlsState(): void {
  store.isInitialized = false;
  store.isLoading = false;
  store.error = null;
  store.userId = null;

  // Reject all pending requests
  for (const [, pending] of pendingRequests) {
    pending.reject(new Error('Instance switched'));
  }
  pendingRequests.clear();

  // Terminate and clear the worker
  if (worker) {
    worker.terminate();
    worker = null;
  }

  emitChange();
}

/**
 * React hook for MLS operations
 */
export function useMLS(): UseMlsReturn {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const initialize = useCallback(async (userId: string): Promise<void> => {
    if (store.isInitialized && store.userId === userId) {
      return;
    }

    store.isLoading = true;
    store.error = null;
    store.userId = userId;
    emitChange();

    const response = await sendRequest({ type: 'init', userId });

    if (response.type !== 'initialized') {
      throw new Error('Unexpected response type');
    }
  }, []);

  const generateKeyPackages = useCallback(
    async (count: number): Promise<MlsKeyPackage[]> => {
      if (!store.isInitialized) {
        throw new Error('MLS client not initialized');
      }

      const response = await sendRequest({
        type: 'generateKeyPackages',
        count
      });

      if (response.type !== 'keyPackages') {
        throw new Error('Unexpected response type');
      }

      return response.packages;
    },
    []
  );

  const createGroup = useCallback(
    async (
      groupName: string
    ): Promise<{ groupId: string; mlsGroupId: string }> => {
      if (!store.isInitialized) {
        throw new Error('MLS client not initialized');
      }

      const response = await sendRequest({ type: 'createGroup', groupName });

      if (response.type !== 'groupCreated') {
        throw new Error('Unexpected response type');
      }

      return {
        groupId: response.groupId,
        mlsGroupId: response.mlsGroupId
      };
    },
    []
  );

  const joinGroup = useCallback(
    async (
      welcomeData: string
    ): Promise<{ groupId: string; mlsGroupId: string }> => {
      if (!store.isInitialized) {
        throw new Error('MLS client not initialized');
      }

      const response = await sendRequest({ type: 'joinGroup', welcomeData });

      if (response.type !== 'groupJoined') {
        throw new Error('Unexpected response type');
      }

      return {
        groupId: response.groupId,
        mlsGroupId: response.mlsGroupId
      };
    },
    []
  );

  const addMembers = useCallback(
    async (
      groupId: string,
      keyPackages: string[]
    ): Promise<{
      commit: string;
      welcomes: Array<{ keyPackageRef: string; welcome: string }>;
    }> => {
      if (!store.isInitialized) {
        throw new Error('MLS client not initialized');
      }

      const response = await sendRequest({
        type: 'addMembers',
        groupId,
        keyPackages
      });

      if (response.type !== 'membersAdded') {
        throw new Error('Unexpected response type');
      }

      return {
        commit: response.commit,
        welcomes: response.welcomes
      };
    },
    []
  );

  const encrypt = useCallback(
    async (
      groupId: string,
      plaintext: string
    ): Promise<{ ciphertext: string; epoch: number }> => {
      if (!store.isInitialized) {
        throw new Error('MLS client not initialized');
      }

      const response = await sendRequest({
        type: 'encrypt',
        groupId,
        plaintext
      });

      if (response.type !== 'encrypted') {
        throw new Error('Unexpected response type');
      }

      return {
        ciphertext: response.ciphertext,
        epoch: response.epoch
      };
    },
    []
  );

  const decrypt = useCallback(
    async (
      groupId: string,
      ciphertext: string
    ): Promise<{ plaintext: string; senderIndex: number } | null> => {
      if (!store.isInitialized) {
        throw new Error('MLS client not initialized');
      }

      const response = await sendRequest({
        type: 'decrypt',
        groupId,
        ciphertext
      });

      // Commit messages update state but have no content - return null to indicate this
      if (response.type === 'commitProcessed') {
        return null;
      }

      if (response.type !== 'decrypted') {
        throw new Error('Unexpected response type');
      }

      return {
        plaintext: response.plaintext,
        senderIndex: response.senderIndex
      };
    },
    []
  );

  const getEpoch = useCallback(async (groupId: string): Promise<number> => {
    if (!store.isInitialized) {
      throw new Error('MLS client not initialized');
    }

    const response = await sendRequest({ type: 'getEpoch', groupId });

    if (response.type !== 'epoch') {
      throw new Error('Unexpected response type');
    }

    return response.epoch;
  }, []);

  const exportState = useCallback(async (): Promise<unknown> => {
    if (!store.isInitialized) {
      throw new Error('MLS client not initialized');
    }

    const response = await sendRequest({ type: 'exportState' });

    if (response.type !== 'stateExported') {
      throw new Error('Unexpected response type');
    }

    return response.state;
  }, []);

  return useMemo(
    () => ({
      ...state,
      initialize,
      generateKeyPackages,
      createGroup,
      joinGroup,
      addMembers,
      encrypt,
      decrypt,
      getEpoch,
      exportState
    }),
    [
      state,
      initialize,
      generateKeyPackages,
      createGroup,
      joinGroup,
      addMembers,
      encrypt,
      decrypt,
      getEpoch,
      exportState
    ]
  );
}

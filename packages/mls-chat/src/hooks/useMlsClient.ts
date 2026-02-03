/**
 * Hook for accessing the MLS client instance.
 * Manages initialization and provides MLS operations.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useMlsChatUser } from '../context/index.js';
import { MlsClient, MlsStorage } from '../lib/index.js';

interface UseMlsClientResult {
  client: MlsClient | null;
  isInitialized: boolean;
  isInitializing: boolean;
  error: Error | null;
  hasCredential: boolean;
  generateCredential: () => Promise<void>;
}

export function useMlsClient(): UseMlsClientResult {
  const { userId } = useMlsChatUser();
  const clientRef = useRef<MlsClient | null>(null);
  const storageRef = useRef<MlsStorage | null>(null);

  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasCredential, setHasCredential] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function initClient(): Promise<void> {
      if (clientRef.current) return;

      setIsInitializing(true);
      setError(null);

      try {
        const storage = new MlsStorage();
        storageRef.current = storage;

        const client = new MlsClient(userId, storage);
        await client.init();

        if (!mounted) {
          client.close();
          return;
        }

        clientRef.current = client;

        // Check if we have a credential
        const credential = await storage.getCredential(userId);
        setHasCredential(!!credential);

        setIsInitialized(true);
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error
              ? err
              : new Error('Failed to initialize MLS client')
          );
        }
      } finally {
        if (mounted) {
          setIsInitializing(false);
        }
      }
    }

    initClient();

    return () => {
      mounted = false;
      if (clientRef.current) {
        clientRef.current.close();
        clientRef.current = null;
      }
    };
  }, [userId]);

  const generateCredential = useCallback(async () => {
    if (!clientRef.current) {
      throw new Error('MLS client not initialized');
    }

    await clientRef.current.generateCredential();
    setHasCredential(true);
  }, []);

  return {
    client: clientRef.current,
    isInitialized,
    isInitializing,
    error,
    hasCredential,
    generateCredential
  };
}

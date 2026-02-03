/**
 * Hook for managing MLS key packages.
 * Handles uploading key packages to the server and local key package generation.
 */

import type { MlsKeyPackage } from '@rapid/shared';
import { MLS_CIPHERSUITES } from '@rapid/shared';
import { useCallback, useEffect, useState } from 'react';

import { useMlsChatApi } from '../context/index.js';
import type { MlsClient } from '../lib/index.js';

interface UseKeyPackagesResult {
  keyPackages: MlsKeyPackage[];
  isLoading: boolean;
  error: Error | null;
  generateAndUpload: (count?: number) => Promise<void>;
  deleteKeyPackage: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const MIN_KEY_PACKAGES = 5;

export function useKeyPackages(client: MlsClient | null): UseKeyPackagesResult {
  const { apiBaseUrl, getAuthHeader } = useMlsChatApi();

  const [keyPackages, setKeyPackages] = useState<MlsKeyPackage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchKeyPackages = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      const authValue = getAuthHeader?.();
      if (authValue) {
        headers['Authorization'] = authValue;
      }

      const response = await fetch(`${apiBaseUrl}/v1/mls/key-packages/me`, {
        headers
      });

      if (!response.ok) {
        throw new Error('Failed to fetch key packages');
      }

      const data = (await response.json()) as { keyPackages: MlsKeyPackage[] };
      setKeyPackages(data.keyPackages);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to fetch key packages')
      );
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, getAuthHeader]);

  const generateAndUpload = useCallback(
    async (count = MIN_KEY_PACKAGES) => {
      if (!client) {
        throw new Error('MLS client not initialized');
      }

      setIsLoading(true);
      setError(null);

      try {
        const newKeyPackages: Array<{
          keyPackageData: string;
          keyPackageRef: string;
          cipherSuite: number;
        }> = [];

        for (let i = 0; i < count; i++) {
          const kp = await client.generateKeyPackage();
          newKeyPackages.push({
            keyPackageRef: kp.ref,
            keyPackageData: btoa(String.fromCharCode(...kp.keyPackageBytes)),
            cipherSuite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519
          });
        }

        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        const authValue = getAuthHeader?.();
        if (authValue) {
          headers['Authorization'] = authValue;
        }

        const response = await fetch(`${apiBaseUrl}/v1/mls/key-packages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ keyPackages: newKeyPackages })
        });

        if (!response.ok) {
          throw new Error('Failed to upload key packages');
        }

        await fetchKeyPackages();
      } catch (err) {
        setError(
          err instanceof Error
            ? err
            : new Error('Failed to generate key packages')
        );
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [client, apiBaseUrl, getAuthHeader, fetchKeyPackages]
  );

  const deleteKeyPackage = useCallback(
    async (id: string) => {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      const authValue = getAuthHeader?.();
      if (authValue) {
        headers['Authorization'] = authValue;
      }

      const response = await fetch(`${apiBaseUrl}/v1/mls/key-packages/${id}`, {
        method: 'DELETE',
        headers
      });

      if (!response.ok) {
        throw new Error('Failed to delete key package');
      }

      setKeyPackages((prev) => prev.filter((kp) => kp.id !== id));
    },
    [apiBaseUrl, getAuthHeader]
  );

  useEffect(() => {
    if (client) {
      fetchKeyPackages();
    }
  }, [client, fetchKeyPackages]);

  return {
    keyPackages,
    isLoading,
    error,
    generateAndUpload,
    deleteKeyPackage,
    refresh: fetchKeyPackages
  };
}

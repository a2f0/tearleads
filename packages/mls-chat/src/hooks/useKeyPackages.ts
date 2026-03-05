/**
 * Hook for managing MLS key packages.
 * Handles uploading key packages to the server and local key package generation.
 */

import type { MlsV2Routes } from '@tearleads/api-client/mlsRoutes';
import type { MlsCipherSuite } from '@tearleads/shared';
import { MLS_CIPHERSUITES } from '@tearleads/shared';
import { useCallback, useEffect, useState } from 'react';

import { useMlsRoutes } from '../context/index.js';
import type { MlsClient } from '../lib/index.js';

interface UseKeyPackagesResult {
  keyPackages: MlsBinaryKeyPackage[];
  isLoading: boolean;
  error: Error | null;
  generateAndUpload: (count?: number) => Promise<void>;
  deleteKeyPackage: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const MIN_KEY_PACKAGES = 5;

type MlsBinaryKeyPackage = Awaited<
  ReturnType<MlsV2Routes['getMyKeyPackages']>
>['keyPackages'][number];

export function useKeyPackages(client: MlsClient | null): UseKeyPackagesResult {
  const mlsRoutes = useMlsRoutes();

  const [keyPackages, setKeyPackages] = useState<MlsBinaryKeyPackage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchKeyPackages = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await mlsRoutes.getMyKeyPackages();
      setKeyPackages(data.keyPackages);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to fetch key packages')
      );
    } finally {
      setIsLoading(false);
    }
  }, [mlsRoutes]);

  const generateAndUpload = useCallback(
    async (count = MIN_KEY_PACKAGES) => {
      if (!client) {
        throw new Error('MLS client not initialized');
      }

      setIsLoading(true);
      setError(null);

      try {
        const newKeyPackages: Array<{
          keyPackageData: Uint8Array;
          keyPackageRef: string;
          cipherSuite: MlsCipherSuite;
        }> = [];

        for (let i = 0; i < count; i++) {
          const kp = await client.generateKeyPackage();
          newKeyPackages.push({
            keyPackageRef: kp.ref,
            keyPackageData: kp.keyPackageBytes,
            cipherSuite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519
          });
        }

        await mlsRoutes.uploadKeyPackages({ keyPackages: newKeyPackages });

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
    [client, mlsRoutes, fetchKeyPackages]
  );

  const deleteKeyPackage = useCallback(
    async (id: string) => {
      await mlsRoutes.deleteKeyPackage(id);
      setKeyPackages((prev) => prev.filter((kp) => kp.id !== id));
    },
    [mlsRoutes]
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

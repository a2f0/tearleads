import { useCallback, useEffect, useState } from 'react';
import { getKeychainDependencies } from './keychainDependencies';
import type { InstanceMetadata, KeyStatus } from './types';

interface InstanceKeyInfo {
  instance: InstanceMetadata;
  keyStatus: KeyStatus;
}

interface UseKeychainInstanceDetailOptions {
  instanceId: string | undefined;
  onDeleted: () => void;
}

export function useKeychainInstanceDetail({
  instanceId,
  onDeleted
}: UseKeychainInstanceDetailOptions) {
  const dependencies = getKeychainDependencies();
  const [instanceInfo, setInstanceInfo] = useState<InstanceKeyInfo | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sessionKeysDialogOpen, setSessionKeysDialogOpen] = useState(false);

  const fetchInstanceInfo = useCallback(async () => {
    if (!instanceId) {
      setLoading(false);
      return;
    }
    if (!dependencies) {
      setError('Keychain is not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const instance = await dependencies.getInstance(instanceId);
      if (!instance) {
        setError('Instance not found');
        return;
      }

      const keyStatus = await dependencies.getKeyStatusForInstance(instanceId);
      setInstanceInfo({ instance, keyStatus });
    } catch (err) {
      console.error('Failed to fetch instance info:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [dependencies, instanceId]);

  useEffect(() => {
    void fetchInstanceInfo();
  }, [fetchInstanceInfo]);

  const handleDeleteSessionKeys = useCallback(async () => {
    if (!instanceInfo) {
      return;
    }
    if (!dependencies) {
      throw new Error('Keychain is not configured.');
    }

    try {
      await dependencies.deleteSessionKeysForInstance(instanceInfo.instance.id);
      const newKeyStatus = await dependencies.getKeyStatusForInstance(
        instanceInfo.instance.id
      );
      setInstanceInfo((prev) =>
        prev ? { ...prev, keyStatus: newKeyStatus } : prev
      );
    } catch (err) {
      console.error('Failed to delete session keys:', err);
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [dependencies, instanceInfo]);

  const handleDeleteInstance = useCallback(async () => {
    if (!instanceInfo) {
      return;
    }
    if (!dependencies) {
      throw new Error('Keychain is not configured.');
    }

    try {
      await dependencies.resetInstanceKeys(instanceInfo.instance.id);
      await dependencies.deleteInstanceFromRegistry(instanceInfo.instance.id);
      onDeleted();
    } catch (err) {
      console.error('Failed to delete instance:', err);
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [dependencies, instanceInfo, onDeleted]);

  const hasSessionKeys =
    instanceInfo?.keyStatus.wrappingKey || instanceInfo?.keyStatus.wrappedKey;

  return {
    instanceInfo,
    loading,
    error,
    deleteDialogOpen,
    sessionKeysDialogOpen,
    hasSessionKeys,
    setDeleteDialogOpen,
    setSessionKeysDialogOpen,
    handleDeleteSessionKeys,
    handleDeleteInstance
  };
}

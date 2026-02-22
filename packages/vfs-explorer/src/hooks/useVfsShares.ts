import type {
  CreateOrgShareRequest,
  CreateVfsShareRequest,
  UpdateVfsShareRequest,
  VfsOrgShare,
  VfsShare
} from '@tearleads/shared';
import { useCallback, useEffect, useState } from 'react';
import { useVfsExplorerContext } from '../context';

export interface UseVfsSharesResult {
  shares: VfsShare[];
  orgShares: VfsOrgShare[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createShare: (
    request: Omit<CreateVfsShareRequest, 'itemId'>
  ) => Promise<VfsShare | null>;
  updateShare: (
    shareId: string,
    request: UpdateVfsShareRequest
  ) => Promise<VfsShare | null>;
  deleteShare: (shareId: string) => Promise<boolean>;
  createOrgShare: (
    request: Omit<CreateOrgShareRequest, 'itemId'>
  ) => Promise<VfsOrgShare | null>;
  deleteOrgShare: (shareId: string) => Promise<boolean>;
}

export function useVfsShares(itemId: string | null): UseVfsSharesResult {
  const { vfsShareApi } = useVfsExplorerContext();
  const [shares, setShares] = useState<VfsShare[]>([]);
  const [orgShares, setOrgShares] = useState<VfsOrgShare[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchShares = useCallback(async () => {
    if (!itemId || !vfsShareApi) {
      setShares([]);
      setOrgShares([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await vfsShareApi.getShares(itemId);
      setShares(response.shares);
      setOrgShares(response.orgShares);
    } catch (err) {
      console.error('Failed to fetch VFS shares:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [itemId, vfsShareApi]);

  useEffect(() => {
    if (itemId && vfsShareApi) {
      fetchShares();
    }
  }, [itemId, vfsShareApi, fetchShares]);

  const createShare = useCallback(
    async (
      request: Omit<CreateVfsShareRequest, 'itemId'>
    ): Promise<VfsShare | null> => {
      if (!itemId || !vfsShareApi) {
        return null;
      }

      try {
        const share = await vfsShareApi.createShare({
          ...request,
          itemId
        });
        setShares((prev) => [share, ...prev]);
        return share;
      } catch (err) {
        console.error('Failed to create share:', err);
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [itemId, vfsShareApi]
  );

  const updateShare = useCallback(
    async (
      shareId: string,
      request: UpdateVfsShareRequest
    ): Promise<VfsShare | null> => {
      if (!vfsShareApi) {
        return null;
      }

      try {
        const share = await vfsShareApi.updateShare(shareId, request);
        setShares((prev) => prev.map((s) => (s.id === shareId ? share : s)));
        return share;
      } catch (err) {
        console.error('Failed to update share:', err);
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [vfsShareApi]
  );

  const deleteShare = useCallback(
    async (shareId: string): Promise<boolean> => {
      if (!vfsShareApi) {
        return false;
      }

      try {
        const result = await vfsShareApi.deleteShare(
          shareId,
          itemId ?? undefined
        );
        if (result.deleted) {
          setShares((prev) => prev.filter((s) => s.id !== shareId));
        }
        return result.deleted;
      } catch (err) {
        console.error('Failed to delete share:', err);
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [itemId, vfsShareApi]
  );

  const createOrgShare = useCallback(
    async (
      request: Omit<CreateOrgShareRequest, 'itemId'>
    ): Promise<VfsOrgShare | null> => {
      if (!itemId || !vfsShareApi) {
        return null;
      }

      try {
        const orgShare = await vfsShareApi.createOrgShare({
          ...request,
          itemId
        });
        setOrgShares((prev) => [orgShare, ...prev]);
        return orgShare;
      } catch (err) {
        console.error('Failed to create org share:', err);
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [itemId, vfsShareApi]
  );

  const deleteOrgShare = useCallback(
    async (shareId: string): Promise<boolean> => {
      if (!vfsShareApi) {
        return false;
      }

      try {
        const result = await vfsShareApi.deleteOrgShare(
          shareId,
          itemId ?? undefined
        );
        if (result.deleted) {
          setOrgShares((prev) => prev.filter((s) => s.id !== shareId));
        }
        return result.deleted;
      } catch (err) {
        console.error('Failed to delete org share:', err);
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [itemId, vfsShareApi]
  );

  return {
    shares,
    orgShares,
    loading,
    error,
    refetch: fetchShares,
    createShare,
    updateShare,
    deleteShare,
    createOrgShare,
    deleteOrgShare
  };
}

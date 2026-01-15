import { Info, Key, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { RefreshButton } from '@/components/ui/refresh-button';
import {
  deleteSessionKeysForInstance,
  getKeyStatusForInstance
} from '@/db/crypto/key-manager';
import { getInstances } from '@/db/instance-registry';
import { useTypedTranslation } from '@/i18n';
import { useNavigateWithFrom } from '@/lib/navigation';
import { type InstanceKeyInfo, InstanceKeyRow } from './InstanceKeyRow';

export function Keychain() {
  const navigateWithFrom = useNavigateWithFrom();
  const { t } = useTypedTranslation('contextMenu');
  const [instanceKeyInfos, setInstanceKeyInfos] = useState<InstanceKeyInfo[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    info: InstanceKeyInfo;
    x: number;
    y: number;
  } | null>(null);

  const fetchKeychainData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const instances = await getInstances();

      const keyInfoPromises = instances.map(async (instance) => ({
        instance,
        keyStatus: await getKeyStatusForInstance(instance.id)
      }));

      const infos = await Promise.all(keyInfoPromises);

      setInstanceKeyInfos(infos);
      // Expand all by default
      setExpandedIds(new Set(infos.map((i) => i.instance.id)));
    } catch (err) {
      console.error('Failed to fetch keychain data:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeychainData();
  }, [fetchKeychainData]);

  const handleDeleteSessionKeys = async (instanceId: string) => {
    const instance = instanceKeyInfos.find((i) => i.instance.id === instanceId);
    const name = instance?.instance.name || instanceId;

    const confirmationMessage = `Are you sure you want to delete session keys for "${name}"?\n\nThis will end your session and require re-entering your password.`;

    if (!window.confirm(confirmationMessage)) return;

    try {
      await deleteSessionKeysForInstance(instanceId);
      await fetchKeychainData();
    } catch (err) {
      console.error('Failed to delete session keys:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggle = (instanceId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  };

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, info: InstanceKeyInfo) => {
      e.preventDefault();
      setContextMenu({ info, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleViewDetails = useCallback(
    (info: InstanceKeyInfo) => {
      setContextMenu(null);
      navigateWithFrom(`/keychain/${info.instance.id}`, {
        fromLabel: 'Back to Keychain'
      });
    },
    [navigateWithFrom]
  );

  const instanceCount = instanceKeyInfos.length;
  const instanceLabel = instanceCount === 1 ? 'instance' : 'instances';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl tracking-tight">
            Keychain Browser
          </h1>
          <p className="text-muted-foreground text-sm">
            {instanceCount} {instanceLabel}
          </p>
        </div>
        <RefreshButton onClick={fetchKeychainData} loading={loading} />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-lg border">
        {loading && instanceKeyInfos.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading keychain contents...
          </div>
        ) : instanceKeyInfos.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
            <Key className="mb-2 h-8 w-8" />
            <p>No instances found.</p>
          </div>
        ) : (
          instanceKeyInfos.map((info) => (
            <InstanceKeyRow
              key={info.instance.id}
              info={info}
              onDeleteSessionKeys={handleDeleteSessionKeys}
              isExpanded={expandedIds.has(info.instance.id)}
              onToggle={() => handleToggle(info.instance.id)}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          <ContextMenuItem
            icon={<Info className="h-4 w-4" />}
            onClick={() => handleViewDetails(contextMenu.info)}
          >
            {t('viewDetails')}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}

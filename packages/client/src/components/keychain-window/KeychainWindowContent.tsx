import { Info, Key, Loader2 } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState
} from 'react';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import {
  deleteSessionKeysForInstance,
  getKeyStatusForInstance
} from '@/db/crypto/key-manager';
import { getInstances } from '@/db/instance-registry';
import { useTypedTranslation } from '@/i18n';
import { DeleteSessionKeysDialog } from '@/pages/keychain/DeleteSessionKeysDialog';
import {
  type InstanceKeyInfo,
  InstanceKeyRow
} from '@/pages/keychain/InstanceKeyRow';

export interface KeychainWindowContentRef {
  refresh: () => void;
}

interface KeychainWindowContentProps {
  onSelectInstance?: (instanceId: string) => void;
}

export const KeychainWindowContent = forwardRef<
  KeychainWindowContentRef,
  KeychainWindowContentProps
>(function KeychainWindowContent({ onSelectInstance }, ref) {
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
  const [deleteSessionKeysInstance, setDeleteSessionKeysInstance] =
    useState<InstanceKeyInfo | null>(null);

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

  useImperativeHandle(
    ref,
    () => ({
      refresh: fetchKeychainData
    }),
    [fetchKeychainData]
  );

  const handleDeleteSessionKeysClick = (instanceId: string) => {
    const instance = instanceKeyInfos.find((i) => i.instance.id === instanceId);
    if (instance) {
      setDeleteSessionKeysInstance(instance);
    }
  };

  const handleDeleteSessionKeys = async () => {
    if (!deleteSessionKeysInstance) return;
    const { id: instanceId } = deleteSessionKeysInstance.instance;

    try {
      await deleteSessionKeysForInstance(instanceId);

      // Update just the modified instance instead of a full refetch
      const newKeyStatus = await getKeyStatusForInstance(instanceId);
      setInstanceKeyInfos((prevInfos) =>
        prevInfos.map((info) =>
          info.instance.id === instanceId
            ? { ...info, keyStatus: newKeyStatus }
            : info
        )
      );
    } catch (err) {
      console.error('Failed to delete session keys:', err);
      setError(err instanceof Error ? err.message : String(err));
      throw err;
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
      onSelectInstance?.(info.instance.id);
    },
    [onSelectInstance]
  );

  const instanceCount = instanceKeyInfos.length;
  const instanceLabel = instanceCount === 1 ? 'instance' : 'instances';

  return (
    <div className="h-full overflow-auto p-3">
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">
          {instanceCount} {instanceLabel}
        </p>

        {error && (
          <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
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
                onDeleteSessionKeys={handleDeleteSessionKeysClick}
                isExpanded={expandedIds.has(info.instance.id)}
                onToggle={() => handleToggle(info.instance.id)}
                onContextMenu={handleContextMenu}
              />
            ))
          )}
        </div>
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

      {deleteSessionKeysInstance && (
        <DeleteSessionKeysDialog
          open={!!deleteSessionKeysInstance}
          onOpenChange={(open) => {
            if (!open) setDeleteSessionKeysInstance(null);
          }}
          instanceName={deleteSessionKeysInstance.instance.name}
          onDelete={handleDeleteSessionKeys}
        />
      )}
    </div>
  );
});

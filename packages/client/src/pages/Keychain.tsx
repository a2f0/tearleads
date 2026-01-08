import {
  Check,
  ChevronDown,
  ChevronRight,
  Key,
  Loader2,
  Trash2,
  X
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import {
  deleteSessionKeysForInstance,
  getKeyStatusForInstance,
  type KeyStatus
} from '@/db/crypto/key-manager';
import { getInstances, type InstanceMetadata } from '@/db/instance-registry';

interface InstanceKeyInfo {
  instance: InstanceMetadata;
  keyStatus: KeyStatus;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function KeyStatusIndicator({
  exists,
  label
}: {
  exists: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {exists ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <X className="h-4 w-4 text-muted-foreground" />
      )}
      <span className="text-muted-foreground text-sm">{label}</span>
    </div>
  );
}

function InstanceKeyRow({
  info,
  onDeleteSessionKeys,
  isExpanded,
  onToggle
}: {
  info: InstanceKeyInfo;
  onDeleteSessionKeys: (instanceId: string) => void;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const hasSessionKeys =
    info.keyStatus.wrappingKey || info.keyStatus.wrappedKey;

  return (
    <div className="border-b last:border-b-0">
      <div className="group flex items-center justify-between p-3 hover:bg-accent">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-2 text-left"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Key className="h-4 w-4 text-amber-500" />
          <span className="font-medium">{info.instance.name}</span>
          <span className="font-mono text-muted-foreground text-xs">
            {info.instance.id.slice(0, 8)}...
          </span>
        </button>
        {hasSessionKeys && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100"
            onClick={() => onDeleteSessionKeys(info.instance.id)}
            title="Delete session keys"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
      {isExpanded && (
        <div className="space-y-3 bg-muted/30 px-9 py-3">
          <div className="text-muted-foreground text-xs">
            <p>Created: {formatDate(info.instance.createdAt)}</p>
            <p>Last accessed: {formatDate(info.instance.lastAccessedAt)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <KeyStatusIndicator exists={info.keyStatus.salt} label="Salt" />
            <KeyStatusIndicator
              exists={info.keyStatus.keyCheckValue}
              label="Key Check Value"
            />
            <KeyStatusIndicator
              exists={info.keyStatus.wrappingKey}
              label="Session Wrapping Key"
            />
            <KeyStatusIndicator
              exists={info.keyStatus.wrappedKey}
              label="Session Wrapped Key"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function Keychain() {
  const [instanceKeyInfos, setInstanceKeyInfos] = useState<InstanceKeyInfo[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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

  const instanceCount = instanceKeyInfos.length;
  const instanceLabel = instanceCount === 1 ? 'instance' : 'instances';

  return (
    <div className="space-y-6 p-6">
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
            />
          ))
        )}
      </div>
    </div>
  );
}

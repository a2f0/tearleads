import { Calendar, Key, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import {
  deleteSessionKeysForInstance,
  getKeyManagerForInstance,
  getKeyStatusForInstance,
  type KeyStatus
} from '@/db/crypto/key-manager';
import {
  deleteInstanceFromRegistry,
  getInstances,
  type InstanceMetadata
} from '@/db/instance-registry';
import { KeyStatusIndicator } from './KeyStatusIndicator';

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

interface InstanceKeyInfo {
  instance: InstanceMetadata;
  keyStatus: KeyStatus;
}

export function KeychainDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [instanceInfo, setInstanceInfo] = useState<InstanceKeyInfo | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInstanceInfo = useCallback(async () => {
    if (!id) return;

    setLoading(true);
    setError(null);

    try {
      const instances = await getInstances();
      const instance = instances.find((i) => i.id === id);

      if (!instance) {
        setError('Instance not found');
        return;
      }

      const keyStatus = await getKeyStatusForInstance(id);
      setInstanceInfo({ instance, keyStatus });
    } catch (err) {
      console.error('Failed to fetch instance info:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchInstanceInfo();
  }, [fetchInstanceInfo]);

  const handleDeleteSessionKeys = useCallback(async () => {
    if (!instanceInfo) return;

    const confirmationMessage = `Are you sure you want to delete session keys for "${instanceInfo.instance.name}"?\n\nThis will end your session and require re-entering your password.`;

    if (!window.confirm(confirmationMessage)) return;

    try {
      await deleteSessionKeysForInstance(instanceInfo.instance.id);
      await fetchInstanceInfo();
    } catch (err) {
      console.error('Failed to delete session keys:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [instanceInfo, fetchInstanceInfo]);

  const handleDeleteInstance = useCallback(async () => {
    if (!instanceInfo) return;

    const confirmationMessage = `Are you sure you want to delete the instance "${instanceInfo.instance.name}"?\n\nThis will permanently remove all keys for this instance.`;

    if (!window.confirm(confirmationMessage)) return;

    try {
      const keyManager = getKeyManagerForInstance(instanceInfo.instance.id);
      await keyManager.reset();
      await deleteInstanceFromRegistry(instanceInfo.instance.id);
      navigate('/keychain');
    } catch (err) {
      console.error('Failed to delete instance:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [instanceInfo, navigate]);

  const hasSessionKeys =
    instanceInfo?.keyStatus.wrappingKey || instanceInfo?.keyStatus.wrappedKey;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackLink defaultTo="/keychain" defaultLabel="Back to Keychain" />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading instance...
        </div>
      )}

      {!loading && !error && instanceInfo && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <Key className="h-6 w-6 text-amber-500" />
            <h1 className="font-bold text-2xl tracking-tight">
              {instanceInfo.instance.name}
            </h1>
          </div>

          <div className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold">Instance Details</h2>
            </div>
            <div className="divide-y">
              <div className="flex items-center gap-3 px-4 py-3">
                <Key className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">
                  Instance ID
                </span>
                <span className="ml-auto break-all font-mono text-sm">
                  {instanceInfo.instance.id}
                </span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Created</span>
                <span className="ml-auto text-sm">
                  {formatDate(instanceInfo.instance.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">
                  Last Accessed
                </span>
                <span className="ml-auto text-sm">
                  {formatDate(instanceInfo.instance.lastAccessedAt)}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold">Key Status</h2>
            </div>
            <div className="grid grid-cols-2 gap-2 p-4">
              <KeyStatusIndicator
                exists={instanceInfo.keyStatus.salt}
                label="Salt"
              />
              <KeyStatusIndicator
                exists={instanceInfo.keyStatus.keyCheckValue}
                label="Key Check Value"
              />
              <KeyStatusIndicator
                exists={instanceInfo.keyStatus.wrappingKey}
                label="Session Wrapping Key"
              />
              <KeyStatusIndicator
                exists={instanceInfo.keyStatus.wrappedKey}
                label="Session Wrapped Key"
              />
            </div>
          </div>

          <div className="flex gap-2">
            {hasSessionKeys && (
              <Button variant="outline" onClick={handleDeleteSessionKeys}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Session Keys
              </Button>
            )}
            <Button variant="outline" onClick={handleDeleteInstance}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Instance
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

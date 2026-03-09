import { BackLink, Button } from '@tearleads/ui';
import { Calendar, Key, Loader2, Trash2 } from 'lucide-react';
import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useKeychainInstanceDetail } from '../../lib/useKeychainInstanceDetail';
import { DeleteKeychainInstanceDialog } from './DeleteKeychainInstanceDialog';
import { DeleteSessionKeysDialog } from './DeleteSessionKeysDialog';
import { KeyStatusIndicator } from './KeyStatusIndicator';

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function KeychainDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const onDeleted = useCallback(() => {
    navigate('/keychain');
  }, [navigate]);
  const {
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
  } = useKeychainInstanceDetail({
    instanceId: id,
    onDeleted
  });

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
            <Key className="h-6 w-6 text-chart-5" />
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
              <Button
                variant="outline"
                onClick={() => setSessionKeysDialogOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Session Keys
              </Button>
            )}
            <Button variant="outline" onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Instance
            </Button>
          </div>
        </div>
      )}
      {instanceInfo && (
        <>
          <DeleteSessionKeysDialog
            open={sessionKeysDialogOpen}
            onOpenChange={setSessionKeysDialogOpen}
            instanceName={instanceInfo.instance.name}
            onDelete={handleDeleteSessionKeys}
          />
          <DeleteKeychainInstanceDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            instanceName={instanceInfo.instance.name}
            onDelete={handleDeleteInstance}
          />
        </>
      )}
    </div>
  );
}

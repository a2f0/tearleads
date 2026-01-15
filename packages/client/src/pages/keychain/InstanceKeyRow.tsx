import { ChevronDown, ChevronRight, Key, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { KeyStatus } from '@/db/crypto/key-manager';
import type { InstanceMetadata } from '@/db/instance-registry';
import { KeyStatusIndicator } from './KeyStatusIndicator';

export interface InstanceKeyInfo {
  instance: InstanceMetadata;
  keyStatus: KeyStatus;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

interface InstanceKeyRowProps {
  info: InstanceKeyInfo;
  onDeleteSessionKeys: (instanceId: string) => void;
  isExpanded: boolean;
  onToggle: () => void;
  onContextMenu?: (e: React.MouseEvent, info: InstanceKeyInfo) => void;
}

export function InstanceKeyRow({
  info,
  onDeleteSessionKeys,
  isExpanded,
  onToggle,
  onContextMenu
}: InstanceKeyRowProps) {
  const hasSessionKeys =
    info.keyStatus.wrappingKey || info.keyStatus.wrappedKey;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Context menu on div is intentional
    <div
      className="border-b last:border-b-0"
      onContextMenu={(e) => onContextMenu?.(e, info)}
    >
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
          <Key className="h-4 w-4 text-chart-5" />
          <span className="font-medium">{info.instance.name}</span>
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
          <p className="font-mono text-muted-foreground text-xs">
            {info.instance.id}
          </p>
          <div className="text-muted-foreground text-xs">
            <p>Created: {formatDate(info.instance.createdAt)}</p>
            <p>Last accessed: {formatDate(info.instance.lastAccessedAt)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <KeyStatusIndicator
              exists={info.keyStatus.salt}
              label="Salt"
              tooltip="Random value used with your password to derive the encryption key"
            />
            <KeyStatusIndicator
              exists={info.keyStatus.keyCheckValue}
              label="Key Check Value"
              tooltip="Hash used to verify your password is correct without storing it"
            />
            <KeyStatusIndicator
              exists={info.keyStatus.wrappingKey}
              label="Session Wrapping Key"
              tooltip="Temporary key that encrypts your session data in memory"
            />
            <KeyStatusIndicator
              exists={info.keyStatus.wrappedKey}
              label="Session Wrapped Key"
              tooltip="Your encryption key protected by the session wrapping key"
            />
          </div>
        </div>
      )}
    </div>
  );
}

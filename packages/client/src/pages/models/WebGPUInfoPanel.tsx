import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

export interface WebGPUInfo {
  adapterName: string;
  vendor: string;
  architecture: string;
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
  maxComputeWorkgroupStorageSize: number;
  maxComputeInvocationsPerWorkgroup: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}

interface WebGPUInfoPanelProps {
  info: WebGPUInfo;
}

export function WebGPUInfoPanel({ info }: WebGPUInfoPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border bg-card p-4">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <h3 className="font-medium text-sm">WebGPU Device</h3>
          <p className="text-muted-foreground text-xs">
            {info.adapterName} ({info.vendor})
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Architecture:</span>
              <span className="ml-2 font-mono">{info.architecture}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Max Buffer:</span>
              <span className="ml-2 font-mono">
                {formatBytes(info.maxBufferSize)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Max Storage Buffer:</span>
              <span className="ml-2 font-mono">
                {formatBytes(info.maxStorageBufferBindingSize)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Workgroup Storage:</span>
              <span className="ml-2 font-mono">
                {formatBytes(info.maxComputeWorkgroupStorageSize)}
              </span>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            Note: Browser ArrayBuffer limit (~2.15GB) may restrict model loading
            regardless of GPU memory.
          </p>
        </div>
      )}
    </div>
  );
}

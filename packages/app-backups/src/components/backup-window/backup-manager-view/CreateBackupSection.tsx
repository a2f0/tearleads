import { Button, Input } from '@tearleads/ui';
import type { BackupProgress } from './utils';
import { formatBytes } from './utils';

interface CreateBackupSectionProps {
  password: string;
  confirmPassword: string;
  includeBlobs: boolean;
  isCreating: boolean;
  createProgress: BackupProgress | null;
  createSuccess: string | null;
  createError: string | null;
  estimatedSize: { blobCount: number; blobTotalSize: number } | null;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onIncludeBlobsChange: (value: boolean) => void;
  onCreate: () => Promise<void> | void;
}

export function CreateBackupSection({
  password,
  confirmPassword,
  includeBlobs,
  isCreating,
  createProgress,
  createSuccess,
  createError,
  estimatedSize,
  onPasswordChange,
  onConfirmPasswordChange,
  onIncludeBlobsChange,
  onCreate
}: CreateBackupSectionProps) {
  return (
    <section>
      <h3 className="mb-2 font-medium text-foreground text-sm">
        Create Backup
      </h3>
      <form
        className="space-y-3 rounded-md border border-border bg-muted/30 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onCreate();
        }}
      >
        {!isCreating && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="backup-password"
                  className="mb-1 block text-muted-foreground text-xs"
                >
                  Password
                </label>
                <Input
                  id="backup-password"
                  data-testid="backup-password-input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => onPasswordChange(e.target.value)}
                  placeholder="Backup password"
                  disabled={isCreating}
                />
              </div>
              <div>
                <label
                  htmlFor="confirm-password"
                  className="mb-1 block text-muted-foreground text-xs"
                >
                  Confirm
                </label>
                <Input
                  id="confirm-password"
                  data-testid="backup-confirm-password-input"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => onConfirmPasswordChange(e.target.value)}
                  placeholder="Confirm password"
                  disabled={isCreating}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-testid="backup-include-blobs"
                  checked={includeBlobs}
                  onChange={(e) => onIncludeBlobsChange(e.target.checked)}
                  disabled={isCreating}
                  className="h-4 w-4 rounded border-input bg-background accent-primary"
                />
                <span className="text-foreground text-xs">
                  Include files
                  {estimatedSize && estimatedSize.blobCount > 0 && (
                    <span className="ml-1 text-muted-foreground">
                      ({estimatedSize.blobCount},{' '}
                      {formatBytes(estimatedSize.blobTotalSize)})
                    </span>
                  )}
                </span>
              </label>
              <Button
                type="submit"
                size="sm"
                data-testid="backup-create-button"
                disabled={!password || !confirmPassword}
              >
                Create Backup
              </Button>
            </div>
          </>
        )}

        {isCreating && !createProgress && (
          <div className="text-foreground text-sm">Starting backup...</div>
        )}

        {createProgress && (
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-foreground">{createProgress.phase}</span>
              <span className="text-muted-foreground">
                {createProgress.percent}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${createProgress.percent}%` }}
              />
            </div>
            {createProgress.currentItem && (
              <p className="mt-1 truncate text-muted-foreground text-xs">
                {createProgress.currentItem}
              </p>
            )}
          </div>
        )}

        {createSuccess && (
          <div
            data-testid="backup-success"
            className="rounded border border-success/40 bg-success/10 p-2 text-success text-xs"
          >
            {createSuccess}
          </div>
        )}

        {createError && (
          <div
            data-testid="backup-error"
            className="rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive text-xs"
          >
            {createError}
          </div>
        )}
      </form>
    </section>
  );
}

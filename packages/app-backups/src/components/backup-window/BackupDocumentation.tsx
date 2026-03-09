import { useTheme } from '@tearleads/ui';
import { ArrowLeft, BookOpenText } from 'lucide-react';
import backupRestoreDocumentation from '../../../../../docs/en/backup-restore.md?raw';
import { MarkdownWithToc } from '../markdown-viewer/MarkdownWithToc';

interface BackupDocumentationProps {
  onBack?: () => void;
}

export function BackupDocumentation({ onBack }: BackupDocumentationProps) {
  const { resolvedTheme } = useTheme();
  const markdownColorMode = resolvedTheme === 'light' ? 'light' : 'dark';

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="space-y-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center text-muted-foreground text-sm hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Backup Manager
          </button>
        )}
        <div className="flex items-center gap-3">
          <BookOpenText className="h-7 w-7 text-muted-foreground" />
          <h2 className="font-semibold text-xl tracking-tight">
            Backup &amp; Restore Documentation
          </h2>
        </div>
        <p className="text-muted-foreground text-sm">
          Full guide for secure backup and restore workflows.
        </p>
      </div>

      <div data-testid="markdown">
        <MarkdownWithToc
          source={backupRestoreDocumentation}
          markdownColorMode={markdownColorMode}
        />
      </div>
    </div>
  );
}

import { MarkdownWithToc } from '@tearleads/backups';
import { useTheme } from '@tearleads/ui';
import { TerminalSquare } from 'lucide-react';
import consoleReferenceDocumentationEn from '../../../../../docs/en/console-reference.md?raw';

export function ConsoleDocumentation() {
  const { resolvedTheme } = useTheme();
  const markdownColorMode = resolvedTheme === 'light' ? 'light' : 'dark';

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <TerminalSquare className="h-7 w-7 text-muted-foreground" />
          <h2 className="font-semibold text-xl tracking-tight">
            Console Reference Documentation
          </h2>
        </div>
        <p className="text-muted-foreground text-sm">
          Command reference for the Console window.
        </p>
      </div>

      <MarkdownWithToc
        source={consoleReferenceDocumentationEn}
        markdownColorMode={markdownColorMode}
      />
    </div>
  );
}

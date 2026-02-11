import { Download, FileText, Puzzle, Terminal } from 'lucide-react';
import { GridSquare } from '@/components/ui/grid-square';
import type { HelpDocId } from '@/constants/help';

interface HelpLinksGridProps {
  onApiDocsClick: () => void;
  onDocClick: (docId: HelpDocId) => void;
}

const HELP_DOC_ITEMS = [
  {
    docId: 'cli',
    label: 'CLI',
    Icon: Terminal
  },
  {
    docId: 'cliReference',
    label: 'CLI Reference',
    Icon: Terminal
  },
  {
    docId: 'chromeExtension',
    label: 'Chrome Extension',
    Icon: Puzzle
  },
  {
    docId: 'backupRestore',
    label: 'Backup & Restore',
    Icon: Download
  }
] as const;

export function HelpLinksGrid({
  onApiDocsClick,
  onDocClick
}: HelpLinksGridProps) {
  return (
    <>
      <GridSquare onClick={onApiDocsClick}>
        <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
          <FileText className="h-12 w-12 text-muted-foreground" />
          <span className="text-center font-medium text-sm">API Docs</span>
        </div>
      </GridSquare>
      {HELP_DOC_ITEMS.map(({ docId, label, Icon }) => (
        <GridSquare key={label} onClick={() => onDocClick(docId)}>
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
            <Icon className="h-12 w-12 text-muted-foreground" />
            <span className="text-center font-medium text-sm">{label}</span>
          </div>
        </GridSquare>
      ))}
    </>
  );
}

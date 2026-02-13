import {
  CodeXml,
  Download,
  FileText,
  Puzzle,
  Shirt,
  TerminalSquare
} from 'lucide-react';
import { GridSquare } from '@/components/ui/grid-square';
import type { HelpDocId } from '@/constants/help';

interface HelpLinksGridProps {
  view: 'topLevel' | 'developer';
  onApiDocsClick: () => void;
  onDeveloperClick: () => void;
  onDocClick: (docId: HelpDocId) => void;
}

const DEVELOPER_DOC_ITEMS = [
  {
    docId: 'cliReference',
    label: 'CLI Reference',
    Icon: TerminalSquare
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
  },
  {
    docId: 'tuxedo',
    label: 'Tuxedo',
    Icon: Shirt
  },
  {
    docId: 'ci',
    label: 'CI',
    Icon: CodeXml
  }
] as const;

export function HelpLinksGrid({
  view,
  onApiDocsClick,
  onDeveloperClick,
  onDocClick
}: HelpLinksGridProps) {
  if (view === 'topLevel') {
    return (
      <>
        <GridSquare onClick={onApiDocsClick}>
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
            <FileText className="h-12 w-12 text-muted-foreground" />
            <span className="text-center font-medium text-sm">API Docs</span>
          </div>
        </GridSquare>
        <GridSquare onClick={onDeveloperClick}>
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
            <CodeXml className="h-12 w-12 text-muted-foreground" />
            <span className="text-center font-medium text-sm">Developer</span>
          </div>
        </GridSquare>
      </>
    );
  }

  return (
    <>
      {DEVELOPER_DOC_ITEMS.map(({ docId, label, Icon }) => (
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

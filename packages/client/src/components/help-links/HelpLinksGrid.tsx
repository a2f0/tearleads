import { Download, FileText, Puzzle, Terminal } from 'lucide-react';
import { HELP_EXTERNAL_LINKS } from '@/constants/help';
import { GridSquare } from '@/components/ui/grid-square';

interface HelpLinksGridProps {
  onApiDocsClick: () => void;
}

const HELP_EXTERNAL_ITEMS = [
  {
    label: 'CLI',
    href: HELP_EXTERNAL_LINKS.cli,
    Icon: Terminal
  },
  {
    label: 'Chrome Extension',
    href: HELP_EXTERNAL_LINKS.chromeExtension,
    Icon: Puzzle
  },
  {
    label: 'Backup & Restore',
    href: HELP_EXTERNAL_LINKS.backupRestore,
    Icon: Download
  }
] as const;

export function HelpLinksGrid({ onApiDocsClick }: HelpLinksGridProps) {
  return (
    <>
      <GridSquare onClick={onApiDocsClick}>
        <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
          <FileText className="h-12 w-12 text-muted-foreground" />
          <span className="text-center font-medium text-sm">API Docs</span>
        </div>
      </GridSquare>
      {HELP_EXTERNAL_ITEMS.map(({ label, href, Icon }) => (
        <GridSquare
          key={label}
          onClick={() => window.open(href, '_blank', 'noopener')}
        >
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
            <Icon className="h-12 w-12 text-muted-foreground" />
            <span className="text-center font-medium text-sm">{label}</span>
          </div>
        </GridSquare>
      ))}
    </>
  );
}


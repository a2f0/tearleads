import type { HelpDocId } from '@help/constants/help';
import { IconSquare } from '@tearleads/ui';
import {
  CodeXml,
  Download,
  FileText,
  FolderTree,
  Puzzle,
  Scale,
  Shield,
  Shirt,
  TerminalSquare
} from 'lucide-react';

interface HelpLinksGridProps {
  view: 'topLevel' | 'developer' | 'legal';
  onApiDocsClick: () => void;
  onDeveloperClick: () => void;
  onLegalClick: () => void;
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
    docId: 'vfs',
    label: 'VFS',
    Icon: FolderTree
  },
  {
    docId: 'ci',
    label: 'CI',
    Icon: CodeXml
  }
] as const;

const LEGAL_DOC_ITEMS = [
  {
    docId: 'privacyPolicy',
    label: 'Privacy Policy',
    Icon: Shield
  },
  {
    docId: 'termsOfService',
    label: 'Terms of Service',
    Icon: Scale
  }
] as const;

export function HelpLinksGrid({
  view,
  onApiDocsClick,
  onDeveloperClick,
  onLegalClick,
  onDocClick
}: HelpLinksGridProps) {
  if (view === 'topLevel') {
    return (
      <>
        <IconSquare icon={FileText} label="API Docs" onClick={onApiDocsClick} />
        <IconSquare
          icon={CodeXml}
          label="Developer"
          onClick={onDeveloperClick}
        />
        <IconSquare icon={Scale} label="Legal" onClick={onLegalClick} />
      </>
    );
  }

  if (view === 'legal') {
    return (
      <>
        {LEGAL_DOC_ITEMS.map(({ docId, label, Icon }) => (
          <IconSquare
            key={label}
            icon={Icon}
            label={label}
            onClick={() => onDocClick(docId)}
          />
        ))}
      </>
    );
  }

  return (
    <>
      {DEVELOPER_DOC_ITEMS.map(({ docId, label, Icon }) => (
        <IconSquare
          key={label}
          icon={Icon}
          label={label}
          onClick={() => onDocClick(docId)}
        />
      ))}
    </>
  );
}

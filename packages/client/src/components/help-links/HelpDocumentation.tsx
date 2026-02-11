import { useTheme } from '@tearleads/ui';
import {
  Download,
  type LucideIcon,
  Puzzle,
  Shirt,
  Terminal,
  TerminalSquare
} from 'lucide-react';
import { MarkdownWithToc } from '@/components/markdown-viewer/MarkdownWithToc';
import { getHelpDocLabel, type HelpDocId } from '@/constants/help';
import type { SupportedLanguage } from '@/i18n';
import { useTypedTranslation } from '@/i18n';
import backupRestoreDocumentationEn from '../../../../../docs/en/backup-restore.md?raw';
import chromeExtensionDocumentationEn from '../../../../../docs/en/chrome-extension.md?raw';
import cliReferenceDocumentationEn from '../../../../../docs/en/cli-reference.md?raw';
import cliDocumentationEn from '../../../../../docs/en/getting-started.md?raw';
import tuxedoDocumentationEn from '../../../../../docs/en/tuxedo.md?raw';
import backupRestoreDocumentationEs from '../../../../../docs/es/backup-restore.md?raw';
import chromeExtensionDocumentationEs from '../../../../../docs/es/chrome-extension.md?raw';
import cliReferenceDocumentationEs from '../../../../../docs/es/cli-reference.md?raw';
import cliDocumentationEs from '../../../../../docs/es/getting-started.md?raw';
import tuxedoDocumentationEs from '../../../../../docs/es/tuxedo.md?raw';
import backupRestoreDocumentationUa from '../../../../../docs/ua/backup-restore.md?raw';
import chromeExtensionDocumentationUa from '../../../../../docs/ua/chrome-extension.md?raw';
import cliReferenceDocumentationUa from '../../../../../docs/ua/cli-reference.md?raw';
import cliDocumentationUa from '../../../../../docs/ua/getting-started.md?raw';
import tuxedoDocumentationUa from '../../../../../docs/ua/tuxedo.md?raw';

const HELP_DOC_MARKDOWN: Record<
  HelpDocId,
  Record<SupportedLanguage, string>
> = {
  cli: {
    en: cliDocumentationEn,
    es: cliDocumentationEs,
    ua: cliDocumentationUa
  },
  cliReference: {
    en: cliReferenceDocumentationEn,
    es: cliReferenceDocumentationEs,
    ua: cliReferenceDocumentationUa
  },
  chromeExtension: {
    en: chromeExtensionDocumentationEn,
    es: chromeExtensionDocumentationEs,
    ua: chromeExtensionDocumentationUa
  },
  backupRestore: {
    en: backupRestoreDocumentationEn,
    es: backupRestoreDocumentationEs,
    ua: backupRestoreDocumentationUa
  },
  tuxedo: {
    en: tuxedoDocumentationEn,
    es: tuxedoDocumentationEs,
    ua: tuxedoDocumentationUa
  }
};

const HELP_DOC_DESCRIPTIONS: Record<HelpDocId, string> = {
  cli: 'Setup and workflow notes for command-line development.',
  cliReference: 'Command reference for the tearleads CLI.',
  chromeExtension: 'Build, load, and test the Tearleads Chrome extension.',
  backupRestore:
    'Full guide for secure backup and restore workflows across platforms.',
  tuxedo: 'Tmux workspace orchestrator setup, usage, and behavior details.'
};

const HELP_DOC_ICONS: Record<HelpDocId, LucideIcon> = {
  cli: Terminal,
  cliReference: TerminalSquare,
  chromeExtension: Puzzle,
  backupRestore: Download,
  tuxedo: Shirt
};

function resolveLanguage(language: string | undefined): SupportedLanguage {
  if (language === 'es') return 'es';
  if (language === 'ua') return 'ua';
  return 'en';
}

interface HelpDocumentationProps {
  docId: HelpDocId;
}

export function HelpDocumentation({ docId }: HelpDocumentationProps) {
  const { i18n } = useTypedTranslation('common');
  const { resolvedTheme } = useTheme();
  const markdownColorMode = resolvedTheme === 'light' ? 'light' : 'dark';
  const language = resolveLanguage(i18n.resolvedLanguage ?? i18n.language);
  const documentation = HELP_DOC_MARKDOWN[docId][language];
  const title = `${getHelpDocLabel(docId)} Documentation`;
  const description = HELP_DOC_DESCRIPTIONS[docId];
  const Icon = HELP_DOC_ICONS[docId];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Icon className="h-7 w-7 text-muted-foreground" />
          <h2 className="font-semibold text-xl tracking-tight">{title}</h2>
        </div>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>

      <MarkdownWithToc
        source={documentation}
        markdownColorMode={markdownColorMode}
      />
    </div>
  );
}

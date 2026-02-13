import { useTheme } from '@tearleads/ui';
import {
  Cog,
  Download,
  type LucideIcon,
  Puzzle,
  Scale,
  Shield,
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
import ciDocumentationEn from '../../../../../docs/en/ci.md?raw';
import cliReferenceDocumentationEn from '../../../../../docs/en/cli-reference.md?raw';
import consoleReferenceDocumentationEn from '../../../../../docs/en/console-reference.md?raw';
import cliDocumentationEn from '../../../../../docs/en/getting-started.md?raw';
import privacyPolicyEn from '../../../../../docs/en/privacy-policy.md?raw';
import termsOfServiceEn from '../../../../../docs/en/terms-of-service.md?raw';
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
  consoleReference: {
    en: consoleReferenceDocumentationEn,
    es: consoleReferenceDocumentationEn,
    ua: consoleReferenceDocumentationEn
  },
  ci: {
    en: ciDocumentationEn,
    es: ciDocumentationEn,
    ua: ciDocumentationEn
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
  },
  privacyPolicy: {
    en: privacyPolicyEn,
    es: privacyPolicyEn,
    ua: privacyPolicyEn
  },
  termsOfService: {
    en: termsOfServiceEn,
    es: termsOfServiceEn,
    ua: termsOfServiceEn
  }
};

const HELP_DOC_DESCRIPTIONS: Record<HelpDocId, string> = {
  cli: 'Setup and workflow notes for command-line development.',
  cliReference: 'Command reference for the tearleads CLI.',
  consoleReference: 'Command reference for the Console window.',
  ci: 'How CI impact analysis and status-check gating works in pull requests.',
  chromeExtension: 'Build, load, and test the Tearleads Chrome extension.',
  backupRestore:
    'Full guide for secure backup and restore workflows across platforms.',
  tuxedo: 'Tmux workspace orchestrator setup, usage, and behavior details.',
  privacyPolicy:
    'How Tearleads collects, uses, and protects your personal information.',
  termsOfService:
    'Terms and conditions governing your use of Tearleads services.'
};

const HELP_DOC_ICONS: Record<HelpDocId, LucideIcon> = {
  cli: Terminal,
  cliReference: TerminalSquare,
  consoleReference: TerminalSquare,
  ci: Cog,
  chromeExtension: Puzzle,
  backupRestore: Download,
  tuxedo: Shirt,
  privacyPolicy: Shield,
  termsOfService: Scale
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

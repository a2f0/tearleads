import type { SearchableDocument } from '@tearleads/search';
import type { HelpDocId } from '@/constants/help';
import { getHelpDocLabel, getHelpDocRouteSegment } from '@/constants/help';
import backupRestoreDocumentationEn from '../../../../docs/en/backup-restore.md?raw';
import chromeExtensionDocumentationEn from '../../../../docs/en/chrome-extension.md?raw';
import cliReferenceDocumentationEn from '../../../../docs/en/cli-reference.md?raw';
import cliDocumentationEn from '../../../../docs/en/getting-started.md?raw';
import vfsDocumentationEn from '../../../../docs/en/vfs.md?raw';

interface SearchableHelpDocDefinition {
  id: HelpDocId;
  keywords: string[];
  content: string;
}

const COMMON_KEYWORDS = ['help', 'docs', 'documentation'] as const;

const SEARCHABLE_HELP_DOCS: SearchableHelpDocDefinition[] = [
  {
    id: 'cli',
    keywords: [...COMMON_KEYWORDS, 'command line'],
    content: cliDocumentationEn
  },
  {
    id: 'cliReference',
    keywords: [...COMMON_KEYWORDS, 'commands', 'reference'],
    content: cliReferenceDocumentationEn
  },
  {
    id: 'chromeExtension',
    keywords: [...COMMON_KEYWORDS, 'browser', 'extension'],
    content: chromeExtensionDocumentationEn
  },
  {
    id: 'backupRestore',
    keywords: [...COMMON_KEYWORDS, 'backup', 'restore'],
    content: backupRestoreDocumentationEn
  },
  {
    id: 'vfs',
    keywords: [...COMMON_KEYWORDS, 'virtual filesystem', 'sharing', 'crypto'],
    content: vfsDocumentationEn
  }
];

export const HELP_DOC_ID_PREFIX = 'help-doc:';

function toHelpDocSearchId(helpDocId: HelpDocId): string {
  return `${HELP_DOC_ID_PREFIX}${helpDocId}`;
}

interface SearchableHelpDocMetadata {
  path: string;
  title: string;
}

const HELP_DOC_BY_SEARCH_ID = new Map<string, SearchableHelpDocMetadata>(
  SEARCHABLE_HELP_DOCS.map((doc) => [
    toHelpDocSearchId(doc.id),
    {
      path: `/help/docs/${getHelpDocRouteSegment(doc.id)}`,
      title: getHelpDocLabel(doc.id)
    }
  ])
);

export function getSearchableHelpDocById(
  id: string
): SearchableHelpDocMetadata | null {
  return HELP_DOC_BY_SEARCH_ID.get(id) ?? null;
}

export function createSearchableHelpDocuments(
  now = Date.now()
): SearchableDocument[] {
  return SEARCHABLE_HELP_DOCS.map((doc) => ({
    id: toHelpDocSearchId(doc.id),
    entityType: 'help_doc',
    title: getHelpDocLabel(doc.id),
    content: doc.content,
    metadata: [
      `/help/docs/${getHelpDocRouteSegment(doc.id)}`,
      ...doc.keywords
    ].join(' '),
    createdAt: now,
    updatedAt: now
  }));
}

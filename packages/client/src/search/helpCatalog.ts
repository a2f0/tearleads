import type { HelpDocId } from '@/constants/help';
import { getHelpDocLabel, getHelpDocRouteSegment } from '@/constants/help';
import backupRestoreDocumentationEn from '../../../../docs/en/backup-restore.md?raw';
import chromeExtensionDocumentationEn from '../../../../docs/en/chrome-extension.md?raw';
import cliReferenceDocumentationEn from '../../../../docs/en/cli-reference.md?raw';
import cliDocumentationEn from '../../../../docs/en/getting-started.md?raw';
import type { SearchableDocument } from './types';

interface SearchableHelpDocDefinition {
  id: HelpDocId;
  keywords: string[];
  content: string;
}

const SEARCHABLE_HELP_DOCS: SearchableHelpDocDefinition[] = [
  {
    id: 'cli',
    keywords: ['help', 'docs', 'documentation', 'command line'],
    content: cliDocumentationEn
  },
  {
    id: 'cliReference',
    keywords: ['help', 'docs', 'documentation', 'commands', 'reference'],
    content: cliReferenceDocumentationEn
  },
  {
    id: 'chromeExtension',
    keywords: ['help', 'docs', 'documentation', 'browser', 'extension'],
    content: chromeExtensionDocumentationEn
  },
  {
    id: 'backupRestore',
    keywords: ['help', 'docs', 'documentation', 'backup', 'restore'],
    content: backupRestoreDocumentationEn
  }
];

const HELP_DOC_ID_PREFIX = 'help-doc:';

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

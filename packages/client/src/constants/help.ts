export type HelpDocId =
  | 'cli'
  | 'cliReference'
  | 'chromeExtension'
  | 'backupRestore';

const HELP_DOC_ROUTE_SEGMENTS: Record<HelpDocId, string> = {
  cli: 'cli',
  cliReference: 'cli-reference',
  chromeExtension: 'chrome-extension',
  backupRestore: 'backup-restore'
};

const HELP_DOC_LABELS: Record<HelpDocId, string> = {
  cli: 'CLI',
  cliReference: 'CLI Reference',
  chromeExtension: 'Chrome Extension',
  backupRestore: 'Backup & Restore'
};

const HELP_DOC_IDS_BY_ROUTE_SEGMENT: Record<string, HelpDocId> = {
  [HELP_DOC_ROUTE_SEGMENTS.cli]: 'cli',
  [HELP_DOC_ROUTE_SEGMENTS.cliReference]: 'cliReference',
  [HELP_DOC_ROUTE_SEGMENTS.chromeExtension]: 'chromeExtension',
  [HELP_DOC_ROUTE_SEGMENTS.backupRestore]: 'backupRestore'
};

export function getHelpDocRouteSegment(docId: HelpDocId): string {
  return HELP_DOC_ROUTE_SEGMENTS[docId];
}

export function getHelpDocLabel(docId: HelpDocId): string {
  return HELP_DOC_LABELS[docId];
}

export function getHelpDocIdFromRouteSegment(
  routeSegment: string
): HelpDocId | null {
  return HELP_DOC_IDS_BY_ROUTE_SEGMENT[routeSegment] ?? null;
}

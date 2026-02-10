export type HelpDocId = 'cli' | 'chromeExtension' | 'backupRestore';

const HELP_DOC_ROUTE_SEGMENTS: Record<HelpDocId, string> = {
  cli: 'cli',
  chromeExtension: 'chrome-extension',
  backupRestore: 'backup-restore'
};

const HELP_DOC_LABELS: Record<HelpDocId, string> = {
  cli: 'CLI',
  chromeExtension: 'Chrome Extension',
  backupRestore: 'Backup & Restore'
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
  if (routeSegment === HELP_DOC_ROUTE_SEGMENTS.cli) return 'cli';
  if (routeSegment === HELP_DOC_ROUTE_SEGMENTS.chromeExtension) {
    return 'chromeExtension';
  }
  if (routeSegment === HELP_DOC_ROUTE_SEGMENTS.backupRestore) {
    return 'backupRestore';
  }
  return null;
}

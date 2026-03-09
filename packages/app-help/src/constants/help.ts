export type HelpDocId =
  | 'cli'
  | 'cliReference'
  | 'consoleReference'
  | 'chromeExtension'
  | 'backupRestore'
  | 'tuxedo'
  | 'ci'
  | 'privacyPolicy'
  | 'termsOfService'
  | 'vfs';

const HELP_DOC_ROUTE_SEGMENTS: Record<HelpDocId, string> = {
  cli: 'cli',
  cliReference: 'cli-reference',
  consoleReference: 'console-reference',
  chromeExtension: 'chrome-extension',
  backupRestore: 'backup-restore',
  tuxedo: 'tuxedo',
  ci: 'ci',
  privacyPolicy: 'privacy-policy',
  termsOfService: 'terms-of-service',
  vfs: 'vfs'
};

const HELP_DOC_LABELS: Record<HelpDocId, string> = {
  cli: 'CLI',
  cliReference: 'CLI Reference',
  consoleReference: 'Console Reference',
  chromeExtension: 'Chrome Extension',
  backupRestore: 'Backup & Restore',
  tuxedo: 'Tuxedo',
  ci: 'CI',
  privacyPolicy: 'Privacy Policy',
  termsOfService: 'Terms of Service',
  vfs: 'VFS'
};

const HELP_DOC_IDS_BY_ROUTE_SEGMENT: Record<string, HelpDocId> = {
  [HELP_DOC_ROUTE_SEGMENTS.cli]: 'cli',
  [HELP_DOC_ROUTE_SEGMENTS.cliReference]: 'cliReference',
  [HELP_DOC_ROUTE_SEGMENTS.consoleReference]: 'consoleReference',
  [HELP_DOC_ROUTE_SEGMENTS.chromeExtension]: 'chromeExtension',
  [HELP_DOC_ROUTE_SEGMENTS.backupRestore]: 'backupRestore',
  [HELP_DOC_ROUTE_SEGMENTS.tuxedo]: 'tuxedo',
  [HELP_DOC_ROUTE_SEGMENTS.ci]: 'ci',
  [HELP_DOC_ROUTE_SEGMENTS.privacyPolicy]: 'privacyPolicy',
  [HELP_DOC_ROUTE_SEGMENTS.termsOfService]: 'termsOfService',
  [HELP_DOC_ROUTE_SEGMENTS.vfs]: 'vfs'
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

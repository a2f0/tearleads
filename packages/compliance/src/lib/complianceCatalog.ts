export interface ComplianceDocument {
  frameworkId: string;
  frameworkLabel: string;
  docPath: string;
  routePath: string;
  title: string;
  source: string;
}

export interface ComplianceFramework {
  id: string;
  label: string;
  defaultRoutePath: string;
  documentCount: number;
}

interface ResolveComplianceLinkParams {
  frameworkId: string;
  currentDocPath: string;
  href: string;
}

const DEFAULT_DOC_PATH = 'POLICY_INDEX.md';

const FRAMEWORK_ORDER = ['SOC2', 'HIPAA', 'NIST.SP.800-53'];

const FRAMEWORK_LABELS: Record<string, string> = {
  SOC2: 'SOC 2',
  HIPAA: 'HIPAA',
  'NIST.SP.800-53': 'NIST SP 800-53'
};

const markdownModules = import.meta.glob('../../../../compliance/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
});

const complianceDocuments = buildComplianceDocuments(markdownModules);

const frameworkDocumentsById = new Map<string, ComplianceDocument[]>();
for (const document of complianceDocuments) {
  const existingDocuments = frameworkDocumentsById.get(document.frameworkId);
  if (existingDocuments) {
    existingDocuments.push(document);
  } else {
    frameworkDocumentsById.set(document.frameworkId, [document]);
  }
}
for (const frameworkDocuments of frameworkDocumentsById.values()) {
  frameworkDocuments.sort(compareDocuments);
}

const documentsByFrameworkAndPath = new Map<string, ComplianceDocument>();
for (const document of complianceDocuments) {
  documentsByFrameworkAndPath.set(
    createFrameworkDocumentKey(document.frameworkId, document.docPath),
    document
  );
}

function buildComplianceDocuments(
  modules: Record<string, unknown>
): ComplianceDocument[] {
  const documents: ComplianceDocument[] = [];

  for (const [modulePath, source] of Object.entries(modules)) {
    if (typeof source !== 'string') {
      continue;
    }

    const marker = '/compliance/';
    const compliancePathStart = modulePath.indexOf(marker);
    if (compliancePathStart < 0) {
      continue;
    }

    const relativePath = modulePath.slice(compliancePathStart + marker.length);
    const pathSegments = relativePath.split('/');
    const frameworkId = pathSegments[0];
    const documentPathSegments = pathSegments.slice(1);

    if (!frameworkId || documentPathSegments.length === 0) {
      continue;
    }

    const normalizedDocPath = normalizeDocPath(documentPathSegments.join('/'));
    if (!normalizedDocPath) {
      continue;
    }

    documents.push({
      frameworkId,
      frameworkLabel: getFrameworkLabel(frameworkId),
      docPath: normalizedDocPath,
      routePath: buildComplianceDocumentRoute(frameworkId, normalizedDocPath),
      title: getDocumentTitle(normalizedDocPath),
      source
    });
  }

  return documents;
}

function compareDocuments(
  a: ComplianceDocument,
  b: ComplianceDocument
): number {
  if (a.docPath === DEFAULT_DOC_PATH && b.docPath !== DEFAULT_DOC_PATH) {
    return -1;
  }

  if (b.docPath === DEFAULT_DOC_PATH && a.docPath !== DEFAULT_DOC_PATH) {
    return 1;
  }

  return a.docPath.localeCompare(b.docPath);
}

function compareFrameworkIds(a: string, b: string): number {
  const aOrder = FRAMEWORK_ORDER.indexOf(a);
  const bOrder = FRAMEWORK_ORDER.indexOf(b);

  if (aOrder >= 0 && bOrder >= 0) {
    return aOrder - bOrder;
  }

  if (aOrder >= 0) {
    return -1;
  }

  if (bOrder >= 0) {
    return 1;
  }

  return a.localeCompare(b);
}

function buildComplianceDocumentRoute(
  frameworkId: string,
  docPath: string
): string {
  return `/compliance/${encodeURIComponent(frameworkId)}/${docPath}`;
}

function createFrameworkDocumentKey(
  frameworkId: string,
  docPath: string
): string {
  return `${frameworkId}:${docPath}`;
}

function getDocumentTitle(docPath: string): string {
  const fileName = getDocFileName(docPath);
  const withoutExtension = fileName.replace(/\.md$/i, '');
  const withoutNumberPrefix = withoutExtension.replace(/^\d{2}-/, '');
  const normalizedTitle = withoutNumberPrefix.toLowerCase();

  return normalizedTitle
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getDocFileName(docPath: string): string {
  const segments = docPath.split('/').filter((segment) => segment.length > 0);
  const fileName = segments[segments.length - 1];
  return fileName ?? docPath;
}

function normalizeDocPath(docPath: string | undefined): string | null {
  if (!docPath || docPath.trim().length === 0) {
    return DEFAULT_DOC_PATH;
  }

  const normalizedInput = docPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const hashlessInput = normalizedInput.split('#')[0];
  const pathWithoutQuery = hashlessInput?.split('?')[0] ?? '';

  const normalizedSegments: string[] = [];
  for (const segment of pathWithoutQuery.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (normalizedSegments.length === 0) {
        return null;
      }

      normalizedSegments.pop();
      continue;
    }

    normalizedSegments.push(segment);
  }

  if (normalizedSegments.length === 0) {
    return DEFAULT_DOC_PATH;
  }

  return normalizedSegments.join('/');
}

function resolveRelativeDocPath(
  currentDocPath: string,
  linkedDocPath: string
): string | null {
  if (linkedDocPath.startsWith('/')) {
    return normalizeDocPath(linkedDocPath.slice(1));
  }

  const currentPathSegments = currentDocPath.split('/');
  currentPathSegments.pop();

  const mergedPath = [...currentPathSegments, ...linkedDocPath.split('/')].join(
    '/'
  );

  return normalizeDocPath(mergedPath);
}

function splitHref(href: string): {
  path: string;
  query: string;
  hash: string;
} {
  const hashIndex = href.indexOf('#');
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : '';
  const hrefWithoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;

  const queryIndex = hrefWithoutHash.indexOf('?');
  const query = queryIndex >= 0 ? hrefWithoutHash.slice(queryIndex) : '';
  const path =
    queryIndex >= 0 ? hrefWithoutHash.slice(0, queryIndex) : hrefWithoutHash;

  return { path, query, hash };
}

export function getFrameworkLabel(frameworkId: string): string {
  return FRAMEWORK_LABELS[frameworkId] ?? frameworkId;
}

export function getComplianceFrameworks(): ComplianceFramework[] {
  const frameworkIds = Array.from(frameworkDocumentsById.keys()).sort(
    compareFrameworkIds
  );

  return frameworkIds.map((frameworkId) => {
    const frameworkDocuments = frameworkDocumentsById.get(frameworkId) ?? [];

    return {
      id: frameworkId,
      label: getFrameworkLabel(frameworkId),
      defaultRoutePath: `/compliance/${encodeURIComponent(frameworkId)}`,
      documentCount: frameworkDocuments.length
    };
  });
}

export function getFrameworkDocuments(
  frameworkId: string
): ComplianceDocument[] {
  const frameworkDocuments = frameworkDocumentsById.get(frameworkId);
  if (!frameworkDocuments) {
    return [];
  }

  return [...frameworkDocuments];
}

export function getComplianceDocument(
  frameworkId: string,
  docPath: string | undefined
): ComplianceDocument | null {
  const normalizedDocPath = normalizeDocPath(docPath);
  if (!normalizedDocPath) {
    return null;
  }

  const document = documentsByFrameworkAndPath.get(
    createFrameworkDocumentKey(frameworkId, normalizedDocPath)
  );

  return document ?? null;
}

export function resolveComplianceLink({
  frameworkId,
  currentDocPath,
  href
}: ResolveComplianceLinkParams): string | null {
  const trimmedHref = href.trim();
  if (trimmedHref.length === 0) {
    return null;
  }

  if (trimmedHref.startsWith('#')) {
    return null;
  }

  if (trimmedHref.startsWith('/compliance/')) {
    return trimmedHref;
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmedHref)) {
    return null;
  }

  const { path, query, hash } = splitHref(trimmedHref);
  if (!path.toLowerCase().endsWith('.md')) {
    return null;
  }

  const resolvedDocPath = resolveRelativeDocPath(currentDocPath, path);
  if (!resolvedDocPath) {
    return null;
  }

  return `${buildComplianceDocumentRoute(frameworkId, resolvedDocPath)}${query}${hash}`;
}

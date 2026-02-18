import { MarkdownWithToc } from '@tearleads/backups';
import { BackLink, cn, useTheme } from '@tearleads/ui';
import { FileText, ShieldCheck } from 'lucide-react';
import { type AnchorHTMLAttributes, type ReactNode, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getComplianceDocument,
  getFrameworkDocuments,
  getFrameworkLabel,
  resolveComplianceLink
} from '../../lib/complianceCatalog';

function decodeRouteSegment(segment: string | undefined): string | null {
  if (!segment) {
    return null;
  }

  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function renderExternalMarkdownLink(
  href: string | undefined,
  children: ReactNode,
  props: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children'>,
  onClick: AnchorHTMLAttributes<HTMLAnchorElement>['onClick']
) {
  return (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  );
}

export function ComplianceDocPage() {
  const params = useParams<{ framework: string; '*': string }>();
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();

  const frameworkId = decodeRouteSegment(params.framework);
  const frameworkDocuments = frameworkId
    ? getFrameworkDocuments(frameworkId)
    : [];
  const frameworkLabel = frameworkId
    ? getFrameworkLabel(frameworkId)
    : 'Compliance';
  const activeDocument = frameworkId
    ? getComplianceDocument(frameworkId, params['*'])
    : null;

  const markdownColorMode = resolvedTheme === 'light' ? 'light' : 'dark';

  const renderMarkdownLink = useCallback(
    ({
      href,
      children,
      onClick,
      ...props
    }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
      if (!frameworkId || !activeDocument || !href) {
        return renderExternalMarkdownLink(href, children, props, onClick);
      }

      const complianceRoute = resolveComplianceLink({
        frameworkId,
        currentDocPath: activeDocument.docPath,
        href
      });

      if (!complianceRoute) {
        return renderExternalMarkdownLink(href, children, props, onClick);
      }

      return (
        <a
          href={complianceRoute}
          {...props}
          onClick={(event) => {
            onClick?.(event);
            if (event.defaultPrevented) {
              return;
            }

            event.preventDefault();
            navigate(complianceRoute);
          }}
        >
          {children}
        </a>
      );
    },
    [activeDocument, frameworkId, navigate]
  );

  if (!frameworkId || frameworkDocuments.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-6">
        <div className="space-y-2">
          <BackLink defaultTo="/compliance" defaultLabel="Back to Compliance" />
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-muted-foreground" />
            <h1 className="font-bold text-2xl tracking-tight">Compliance</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            This compliance framework was not found.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
      <div className="space-y-2">
        <BackLink defaultTo="/compliance" defaultLabel="Back to Compliance" />
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">
            {frameworkLabel}
          </h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Browse framework documentation and follow policy/procedure links in
          place.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        <nav
          aria-label="Framework documents"
          className="w-60 shrink-0 overflow-y-auto rounded-md border bg-card p-2"
        >
          <div className="mb-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
            Documents
          </div>
          <div className="space-y-1">
            {frameworkDocuments.map((document) => {
              const isActive = activeDocument?.docPath === document.docPath;

              return (
                <button
                  key={document.routePath}
                  type="button"
                  onClick={() => navigate(document.routePath)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                    isActive && 'bg-accent text-accent-foreground'
                  )}
                >
                  <FileText className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{document.title}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="min-h-0 min-w-0 flex-1">
          {activeDocument ? (
            <MarkdownWithToc
              source={activeDocument.source}
              markdownColorMode={markdownColorMode}
              linkComponent={renderMarkdownLink}
            />
          ) : (
            <div className="rounded-md border bg-card p-4">
              <h2 className="font-semibold text-lg tracking-tight">
                Document Not Found
              </h2>
              <p className="mt-2 text-muted-foreground text-sm">
                This document does not exist in the selected framework.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

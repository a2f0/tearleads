import { MarkdownWithToc } from '@tearleads/backups';
import {
  getComplianceDocument,
  getFrameworkDocuments,
  getFrameworkLabel,
  resolveComplianceLink
} from '@tearleads/compliance';
import { cn, useTheme } from '@tearleads/ui';
import { FileText, ShieldCheck } from 'lucide-react';
import {
  type AnchorHTMLAttributes,
  type ReactNode,
  useCallback,
  useMemo
} from 'react';

interface ComplianceDocViewProps {
  frameworkId: string;
  docPath: string | null;
  onDocSelect: (docPath: string) => void;
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

function extractDocPathFromRoute(route: string): string | null {
  const match = route.match(/^\/compliance\/[^/]+\/(.+)$/);
  return match?.[1] ?? null;
}

export function ComplianceDocView({
  frameworkId,
  docPath,
  onDocSelect
}: ComplianceDocViewProps) {
  const { resolvedTheme } = useTheme();
  const frameworkDocuments = useMemo(
    () => getFrameworkDocuments(frameworkId),
    [frameworkId]
  );
  const frameworkLabel = getFrameworkLabel(frameworkId);

  const activeDocument = useMemo(
    () => getComplianceDocument(frameworkId, docPath ?? undefined),
    [frameworkId, docPath]
  );

  const effectiveDocument = useMemo(() => {
    if (activeDocument) return activeDocument;
    return frameworkDocuments[0] ?? null;
  }, [activeDocument, frameworkDocuments]);

  const markdownColorMode = resolvedTheme === 'light' ? 'light' : 'dark';

  const renderMarkdownLink = useCallback(
    ({
      href,
      children,
      onClick,
      ...props
    }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
      if (!effectiveDocument || !href) {
        return renderExternalMarkdownLink(href, children, props, onClick);
      }

      const complianceRoute = resolveComplianceLink({
        frameworkId,
        currentDocPath: effectiveDocument.docPath,
        href
      });

      if (!complianceRoute) {
        return renderExternalMarkdownLink(href, children, props, onClick);
      }

      const linkedDocPath = extractDocPathFromRoute(complianceRoute);

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
            if (linkedDocPath) {
              onDocSelect(linkedDocPath);
            }
          }}
        >
          {children}
        </a>
      );
    },
    [effectiveDocument, frameworkId, onDocSelect]
  );

  if (frameworkDocuments.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        <div className="space-y-2">
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
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden">
      <div className="space-y-2">
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
              const isActive = effectiveDocument?.docPath === document.docPath;

              return (
                <button
                  key={document.docPath}
                  type="button"
                  onClick={() => onDocSelect(document.docPath)}
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

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MarkdownWithToc
            source={effectiveDocument?.source ?? ''}
            markdownColorMode={markdownColorMode}
            linkComponent={renderMarkdownLink}
          />
        </div>
      </div>
    </div>
  );
}

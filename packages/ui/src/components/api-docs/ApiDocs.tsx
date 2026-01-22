import { ChevronDown } from 'lucide-react';
import type { OpenAPIV3 } from 'openapi-types';
import { cn } from '../../lib/utils.js';
import { ApiDocsOperationCard } from './ApiDocsOperationCard.js';
import { ApiDocsSidebar } from './ApiDocsSidebar.js';
import { buildApiDocsData } from './apiDocsData.js';

interface ApiDocsProps {
  spec: OpenAPIV3.Document;
  className?: string;
  intro?: React.ReactNode;
  header?: React.ReactNode;
  showBaseUrl?: boolean;
  baseUrlLabel?: string;
  fallbackTagLabel?: string;
  tagOrder?: string[];
}

export function ApiDocs({
  spec,
  className,
  intro,
  header,
  showBaseUrl = true,
  baseUrlLabel = 'Base URL',
  fallbackTagLabel = 'General',
  tagOrder
}: ApiDocsProps) {
  const { tagGroups, totalOperations, baseUrl } = buildApiDocsData(spec, {
    fallbackTag: fallbackTagLabel,
    ...(tagOrder ? { tagOrder } : {})
  });

  const title = spec.info.title;
  const version = spec.info.version;
  const description = spec.info.description;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-3xl border bg-card shadow-sm',
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(56,189,248,0.18),transparent_45%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_0%,rgba(34,197,94,0.18),transparent_40%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0)_55%)]" />
      </div>

      <div className="relative space-y-8 px-6 py-8 sm:px-8 lg:px-10">
        {header ? (
          header
        ) : (
          <header className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="rounded-full border border-border/80 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                API Docs
              </p>
              <span className="rounded-full border border-info/30 bg-info/10 px-3 py-1 text-xs font-semibold text-info">
                v{version}
              </span>
            </div>
            <div className="space-y-3">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {title}
              </h1>
              {description ? (
                <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                  {description}
                </p>
              ) : null}
              {intro ? (
                <div className="text-sm text-muted-foreground">{intro}</div>
              ) : null}
            </div>
          </header>
        )}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
          <ApiDocsSidebar
            tagGroups={tagGroups}
            totalOperations={totalOperations}
            showBaseUrl={showBaseUrl}
            baseUrlLabel={baseUrlLabel}
            className="lg:sticky lg:top-6 lg:self-start"
            {...(baseUrl ? { baseUrl } : {})}
          />

          <div className="space-y-8">
            {tagGroups.map((tagGroup) => (
              <details
                key={tagGroup.name}
                id={`tag-${tagGroup.name
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')}`}
                className="group rounded-2xl border bg-background/70 p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
                open
              >
                <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-xl px-2 py-1 transition hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold tracking-tight">
                      {tagGroup.name}
                    </h2>
                    {tagGroup.description ? (
                      <p className="text-sm text-muted-foreground">
                        {tagGroup.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-border/70 bg-muted/40 px-3 py-1 text-xs font-semibold text-muted-foreground">
                      {tagGroup.operations.length} endpoints
                    </span>
                    <ChevronDown className="mt-1 h-4 w-4 text-muted-foreground transition group-open:rotate-180" />
                  </div>
                </summary>

                <div className="mt-4 space-y-3">
                  {tagGroup.operations.map((operation) => (
                    <ApiDocsOperationCard
                      key={operation.id}
                      operation={operation}
                    />
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

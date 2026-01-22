import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import type { ApiOperation } from './apiDocsData.js';

interface ApiDocsOperationCardProps {
  operation: ApiOperation;
}

const METHOD_STYLES: Record<string, string> = {
  get: 'bg-info/15 text-info border-info/30',
  post: 'bg-success/15 text-success border-success/30',
  put: 'bg-warning/20 text-warning border-warning/40',
  patch: 'bg-warning/20 text-warning border-warning/40',
  delete: 'bg-destructive/15 text-destructive border-destructive/30',
  options: 'bg-muted/40 text-muted-foreground border-muted',
  head: 'bg-muted/40 text-muted-foreground border-muted',
  trace: 'bg-muted/40 text-muted-foreground border-muted'
};

export function ApiDocsOperationCard({ operation }: ApiDocsOperationCardProps) {
  const methodStyle =
    METHOD_STYLES[operation.method] ??
    'bg-muted/40 text-muted-foreground border-muted';

  return (
    <details className="group rounded-xl border bg-background/80 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 transition hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <span
          className={cn(
            'inline-flex min-w-[64px] items-center justify-center rounded-full border px-2.5 py-1 font-semibold text-xs uppercase tracking-wide',
            methodStyle
          )}
        >
          {operation.method}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground text-sm">
            {operation.summary}
          </p>
          <p className="truncate font-mono text-muted-foreground text-xs">
            {operation.path}
          </p>
        </div>
        {operation.deprecated ? (
          <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 font-semibold text-[11px] text-destructive">
            Deprecated
          </span>
        ) : null}
        <ChevronDown className="h-4 w-4 text-muted-foreground transition group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t px-4 pt-3 pb-4">
        {operation.description ? (
          <p className="text-muted-foreground text-sm">
            {operation.description}
          </p>
        ) : null}

        {operation.parameters.length > 0 ? (
          <div className="space-y-2">
            <p className="font-semibold text-muted-foreground text-xs uppercase tracking-[0.2em]">
              Parameters
            </p>
            <div className="space-y-2">
              {operation.parameters.map((param) => (
                <div
                  key={`${param.name}-${param.location}`}
                  className="rounded-lg border bg-muted/30 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-foreground text-xs">
                      {param.name}
                    </span>
                    <span className="rounded-full border px-2 py-0.5 font-semibold text-[11px] text-muted-foreground">
                      {param.location}
                    </span>
                    {param.required ? (
                      <span className="rounded-full border border-warning/40 bg-warning/20 px-2 py-0.5 font-semibold text-[11px] text-warning">
                        Required
                      </span>
                    ) : null}
                    {param.schemaType ? (
                      <span className="rounded-full border border-info/30 bg-info/10 px-2 py-0.5 font-semibold text-[11px] text-info">
                        {param.schemaType}
                      </span>
                    ) : null}
                  </div>
                  {param.description ? (
                    <p className="mt-2 text-muted-foreground text-xs">
                      {param.description}
                    </p>
                  ) : null}
                  {param.ref ? (
                    <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
                      {param.ref}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {operation.requestBody ? (
          <div className="space-y-2">
            <p className="font-semibold text-muted-foreground text-xs uppercase tracking-[0.2em]">
              Request body
            </p>
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-muted-foreground text-xs">
              {operation.requestBody.description ? (
                <p className="mb-2">{operation.requestBody.description}</p>
              ) : null}
              {operation.requestBody.contentTypes.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {operation.requestBody.contentTypes.map((type) => (
                    <span
                      key={type}
                      className="rounded-full border px-2 py-0.5 font-mono text-[11px]"
                    >
                      {type}
                    </span>
                  ))}
                </div>
              ) : null}
              {operation.requestBody.ref ? (
                <p className="mt-2 break-all font-mono text-[11px]">
                  {operation.requestBody.ref}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {operation.responses.length > 0 ? (
          <div className="space-y-2">
            <p className="font-semibold text-muted-foreground text-xs uppercase tracking-[0.2em]">
              Responses
            </p>
            <div className="space-y-2">
              {operation.responses.map((response) => (
                <div
                  key={`${operation.id}-${response.status}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs"
                >
                  <span className="rounded-full border px-2 py-0.5 font-mono font-semibold text-[11px]">
                    {response.status}
                  </span>
                  {response.description ? (
                    <span className="text-muted-foreground">
                      {response.description}
                    </span>
                  ) : null}
                  {response.ref ? (
                    <span className="break-all font-mono text-[11px] text-muted-foreground">
                      {response.ref}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}

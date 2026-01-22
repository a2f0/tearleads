import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import type { ApiTagGroup } from './apiDocsData.js';

interface ApiDocsSidebarProps {
  tagGroups: ApiTagGroup[];
  totalOperations: number;
  baseUrl?: string;
  showBaseUrl: boolean;
  baseUrlLabel: string;
  className?: string;
}

export function ApiDocsSidebar({
  tagGroups,
  totalOperations,
  baseUrl,
  showBaseUrl,
  baseUrlLabel,
  className
}: ApiDocsSidebarProps) {
  return (
    <aside
      className={cn(
        'space-y-6 rounded-2xl border bg-background/80 p-4 backdrop-blur',
        'shadow-[0_1px_0_rgba(0,0,0,0.04)]',
        className
      )}
    >
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Overview
        </p>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full border bg-muted/40 px-3 py-1 text-xs font-semibold">
            {totalOperations} endpoints
          </span>
          <span className="inline-flex items-center rounded-full border bg-muted/40 px-3 py-1 text-xs font-semibold">
            {tagGroups.length} groups
          </span>
        </div>
      </div>

      {showBaseUrl && baseUrl ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {baseUrlLabel}
          </p>
          <p className="break-all rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs">
            {baseUrl}
          </p>
        </div>
      ) : null}

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Sections
        </p>
        <nav className="space-y-1">
          {tagGroups.map((tag) => (
            <a
              key={tag.name}
              href={`#tag-${tag.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
              className="group flex items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-border hover:bg-muted/40 hover:text-foreground"
            >
              <span className="truncate">{tag.name}</span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                {tag.operations.length}
                <ChevronRight className="h-3 w-3 text-muted-foreground transition group-hover:translate-x-0.5" />
              </span>
            </a>
          ))}
        </nav>
      </div>
    </aside>
  );
}

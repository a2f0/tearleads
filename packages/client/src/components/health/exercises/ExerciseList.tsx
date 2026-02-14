import type { Exercise } from '@tearleads/health';
import { ChevronDown, ChevronRight, Dumbbell } from 'lucide-react';
import { useState } from 'react';

interface ExerciseListProps {
  parentExercises: Exercise[];
  hierarchy: Map<string, Exercise[]>;
}

export function ExerciseList({
  parentExercises,
  hierarchy
}: ExerciseListProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (parentExercises.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground text-sm">
        No exercises found
      </div>
    );
  }

  return (
    <div className="divide-y">
      {parentExercises.map((parent) => {
        const children = hierarchy.get(parent.id) ?? [];
        const hasChildren = children.length > 0;
        const isExpanded = expandedIds.has(parent.id);

        return (
          <div key={parent.id}>
            <button
              type="button"
              onClick={() => hasChildren && toggleExpanded(parent.id)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left ${
                hasChildren
                  ? 'cursor-pointer hover:bg-muted/50'
                  : 'cursor-default'
              }`}
              aria-expanded={hasChildren ? isExpanded : undefined}
            >
              <Dumbbell className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 font-medium">{parent.name}</span>
              {hasChildren && (
                <>
                  <span className="text-muted-foreground text-xs">
                    {children.length} variation{children.length !== 1 && 's'}
                  </span>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </>
              )}
            </button>
            {hasChildren && isExpanded && (
              <div className="border-t bg-muted/30">
                {children.map((child) => (
                  <div
                    key={child.id}
                    className="flex items-center gap-3 py-2 pr-4 pl-12 text-sm"
                  >
                    <span className="text-muted-foreground">-</span>
                    <span>{child.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

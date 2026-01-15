import { Check, Lock, LockOpen, Trash2 } from 'lucide-react';
import { memo, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface InstanceItemProps {
  instance: { id: string; name: string };
  isSelected: boolean;
  isUnlocked: boolean;
  showDeleteButton: boolean;
  alwaysShowDeleteButton: boolean;
  onSwitch: (instanceId: string) => void;
  onDelete: (e: React.MouseEvent, instanceId: string) => void;
}

export const InstanceItem = memo(function InstanceItem({
  instance,
  isSelected,
  isUnlocked,
  showDeleteButton,
  alwaysShowDeleteButton,
  onSwitch,
  onDelete
}: InstanceItemProps) {
  const handleClick = useCallback(() => {
    onSwitch(instance.id);
  }, [onSwitch, instance.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSwitch(instance.id);
      }
    },
    [onSwitch, instance.id]
  );

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      onDelete(e, instance.id);
    },
    [onDelete, instance.id]
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: div with role="button" required to avoid nested button with delete action
    <div
      role="button"
      tabIndex={0}
      className="group flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      data-testid={`instance-${instance.id}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        {isSelected ? (
          <Check className="h-4 w-4 flex-shrink-0 text-primary" />
        ) : (
          <div className="w-4" />
        )}
        <span className="truncate">{instance.name}</span>
        {isSelected && isUnlocked ? (
          <>
            <LockOpen
              className="h-3.5 w-3.5 flex-shrink-0 text-success"
              data-testid={`instance-unlocked-${instance.id}`}
              aria-hidden="true"
            />
            <span className="sr-only">Unlocked</span>
          </>
        ) : (
          <>
            <Lock
              className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground"
              data-testid={`instance-locked-${instance.id}`}
              aria-hidden="true"
            />
            <span className="sr-only">Locked</span>
          </>
        )}
      </div>
      {showDeleteButton && (
        <button
          type="button"
          className={cn(
            'rounded p-1 transition-opacity hover:bg-destructive/10',
            {
              'opacity-100': alwaysShowDeleteButton,
              'opacity-0 group-hover:opacity-100': !alwaysShowDeleteButton
            }
          )}
          onClick={handleDeleteClick}
          aria-label={`Delete ${instance.name}`}
          data-testid={`delete-instance-${instance.id}`}
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </button>
      )}
    </div>
  );
});

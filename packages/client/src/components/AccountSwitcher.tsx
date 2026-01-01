import { Check, CircleUser, Plus, Trash2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useDatabaseContext } from '@/db/hooks/useDatabase';
import { DeleteInstanceDialog } from './DeleteInstanceDialog';

export function AccountSwitcher() {
  const {
    currentInstanceId,
    currentInstanceName,
    instances,
    isLoading,
    createInstance,
    switchInstance
  } = useDatabaseContext();

  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [instanceToDelete, setInstanceToDelete] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggleDropdown = () => {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right
      });
    }
    setIsOpen(!isOpen);
  };

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (isOpen && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      setMenuPosition((prev) => {
        if (prev.top + rect.height > viewportHeight) {
          return {
            ...prev,
            top: Math.max(8, viewportHeight - rect.height - 8)
          };
        }
        return prev;
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDropdown();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, closeDropdown]);

  const handleSwitchInstance = async (instanceId: string) => {
    closeDropdown();
    if (instanceId !== currentInstanceId) {
      await switchInstance(instanceId);
    }
  };

  const handleCreateInstance = async () => {
    closeDropdown();
    await createInstance();
  };

  const handleDeleteClick = (e: React.MouseEvent, instanceId: string) => {
    e.stopPropagation();
    setInstanceToDelete(instanceId);
    setDeleteDialogOpen(true);
    closeDropdown();
  };

  const instanceToDeleteName = useMemo(
    () => instances.find((i) => i.id === instanceToDelete)?.name,
    [instances, instanceToDelete]
  );

  return (
    <>
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          onClick={toggleDropdown}
          disabled={isLoading}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md px-2 hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          aria-label="Account menu"
          aria-expanded={isOpen}
          aria-haspopup="true"
          data-testid="account-switcher-button"
        >
          <CircleUser className="h-5 w-5" />
          {currentInstanceName && (
            <span className="max-w-24 truncate font-medium text-sm">
              {currentInstanceName}
            </span>
          )}
        </button>

        {isOpen && (
          <div className="fixed inset-0 z-50">
            <button
              type="button"
              className="fixed inset-0 cursor-default"
              onClick={closeDropdown}
              aria-label="Close account menu"
            />
            <div
              ref={menuRef}
              className="fixed z-10 min-w-56 rounded-md border bg-background py-1 shadow-lg"
              style={{ top: menuPosition.top, right: menuPosition.right }}
            >
              {/* Instance list */}
              <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
                Instances
              </div>
              {instances.map((instance) => (
                <button
                  key={instance.id}
                  type="button"
                  className="group flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => handleSwitchInstance(instance.id)}
                  data-testid={`instance-${instance.id}`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {instance.id === currentInstanceId ? (
                      <Check className="h-4 w-4 flex-shrink-0 text-primary" />
                    ) : (
                      <div className="w-4" />
                    )}
                    <span className="truncate">{instance.name}</span>
                  </div>
                  {instances.length > 1 && (
                    <button
                      type="button"
                      className="rounded p-1 opacity-0 transition-opacity hover:bg-destructive/10 group-hover:opacity-100"
                      onClick={(e) => handleDeleteClick(e, instance.id)}
                      aria-label={`Delete ${instance.name}`}
                      data-testid={`delete-instance-${instance.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </button>
                  )}
                </button>
              ))}

              <div className="my-1 h-px bg-border" />

              {/* Create new instance */}
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={handleCreateInstance}
                data-testid="create-instance-button"
              >
                <Plus className="h-4 w-4" />
                Create new instance
              </button>
            </div>
          </div>
        )}
      </div>

      <DeleteInstanceDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        instanceId={instanceToDelete}
        instanceName={instanceToDeleteName ?? ''}
      />
    </>
  );
}

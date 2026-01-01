import { CircleUser, Plus, RefreshCw } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';

export function AccountSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
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

  const handleChangeInstance = () => {
    closeDropdown();
    // TODO: Implement instance switching
    console.log('Change instance');
  };

  const handleCreateInstance = () => {
    closeDropdown();
    // TODO: Implement instance creation
    console.log('Create new instance');
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleDropdown}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
        aria-label="Account menu"
        aria-expanded={isOpen}
        aria-haspopup="true"
        data-testid="account-switcher-button"
      >
        <CircleUser className="h-5 w-5" />
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
            className="fixed z-10 min-w-48 rounded-md border bg-background py-1 shadow-lg"
            style={{ top: menuPosition.top, right: menuPosition.right }}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={handleChangeInstance}
              data-testid="change-instance-button"
            >
              <RefreshCw className="h-4 w-4" />
              Change instance
            </button>
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
  );
}

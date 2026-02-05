import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { cn } from '@/lib/utils';

interface DropdownMenuProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'left' | 'right';
}

interface TriggerElementProps {
  onClick?: (e: React.MouseEvent) => void;
  'aria-haspopup'?: string;
  'aria-expanded'?: boolean;
}

interface ChildProps {
  onClick?: () => void;
  preventClose?: boolean;
}

interface DropdownMenuContextValue {
  close: () => void;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(
  null
);

export function useDropdownMenuContext(): DropdownMenuContextValue | null {
  return useContext(DropdownMenuContext);
}

export function DropdownMenu({
  trigger,
  children,
  align = 'left'
}: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const close = useCallback(() => {
    setIsOpen(false);
    setFocusedIndex(-1);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev);
    setFocusedIndex(-1);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, close]);

  useEffect(() => {
    if (isOpen && menuRef.current) {
      menuRef.current.focus();
    }
  }, [isOpen]);

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not([disabled])'
    );
    if (!items || items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = focusedIndex < items.length - 1 ? focusedIndex + 1 : 0;
      setFocusedIndex(nextIndex);
      items[nextIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = focusedIndex > 0 ? focusedIndex - 1 : items.length - 1;
      setFocusedIndex(prevIndex);
      items[prevIndex]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusedIndex(0);
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      setFocusedIndex(items.length - 1);
      items[items.length - 1]?.focus();
    }
  };

  const contextValue = useMemo<DropdownMenuContextValue>(
    () => ({ close }),
    [close]
  );

  return (
    <DropdownMenuContext.Provider value={contextValue}>
      <div ref={containerRef} className="relative">
        {isValidElement<TriggerElementProps>(trigger) ? (
          cloneElement(trigger, {
            onClick: (e: React.MouseEvent) => {
              toggle();
              trigger.props.onClick?.(e);
            },
            'aria-haspopup': 'menu',
            'aria-expanded': isOpen
          })
        ) : (
          <button
            type="button"
            onClick={toggle}
            className="px-2 py-0.5 text-xs hover:bg-accent"
            aria-haspopup="menu"
            aria-expanded={isOpen}
          >
            {trigger}
          </button>
        )}
        {isOpen && (
          <div
            ref={menuRef}
            role="menu"
            tabIndex={-1}
            onKeyDown={handleMenuKeyDown}
            className={cn(
              'dropdown-menu absolute top-full z-[10000] mt-0.5 min-w-32 rounded border bg-background py-1 shadow-md outline-none',
              align === 'left' ? 'left-0' : 'right-0'
            )}
            data-align={align}
          >
            {Children.map(children, (child) => {
              if (isValidElement<ChildProps>(child) && child.props.onClick) {
                return cloneElement(child, {
                  onClick: () => {
                    child.props.onClick?.();
                    if (!child.props.preventClose) {
                      close();
                    }
                  }
                });
              }
              return child;
            })}
          </div>
        )}
      </div>
    </DropdownMenuContext.Provider>
  );
}

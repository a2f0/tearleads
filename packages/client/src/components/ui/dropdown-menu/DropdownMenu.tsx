import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { cn } from '@/lib/utils';

interface DropdownMenuProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'left' | 'right';
}

interface ChildProps {
  onClick?: () => void;
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
    if (!isOpen || !menuRef.current) return undefined;

    const handleKeyDown = (e: KeyboardEvent) => {
      const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])'
      );
      if (!items || items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex =
          focusedIndex < items.length - 1 ? focusedIndex + 1 : 0;
        setFocusedIndex(nextIndex);
        items[nextIndex]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex =
          focusedIndex > 0 ? focusedIndex - 1 : items.length - 1;
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

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, focusedIndex]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        className="px-2 py-0.5 text-xs hover:bg-accent"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {trigger}
      </button>
      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          className={cn(
            'absolute top-full z-[10000] mt-0.5 min-w-32 rounded border bg-background py-1 shadow-md',
            align === 'left' ? 'left-0' : 'right-0'
          )}
          data-align={align}
        >
          {Children.map(children, (child) => {
            if (isValidElement<ChildProps>(child) && child.props.onClick) {
              return cloneElement(child, {
                onClick: () => {
                  child.props.onClick?.();
                  close();
                }
              });
            }
            return child;
          })}
        </div>
      )}
    </div>
  );
}

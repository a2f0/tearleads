import { handleDropdownMenuKeyboard } from '@tearleads/shared';
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';
import { DROPDOWN_MENU_Z_INDEX } from '../../constants/zIndex.js';

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
  getContainerElement: () => HTMLElement | null;
}

const HIDDEN_MENU_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: -9999,
  left: -9999,
  visibility: 'hidden'
};

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
  const [menuStyle, setMenuStyle] =
    useState<React.CSSProperties>(HIDDEN_MENU_STYLE);

  const close = useCallback(() => {
    setIsOpen(false);
    setFocusedIndex(-1);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const nextIsOpen = !prev;
      if (nextIsOpen) {
        setMenuStyle(HIDDEN_MENU_STYLE);
      }
      return nextIsOpen;
    });
    setFocusedIndex(-1);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!menuRef.current || !menuRef.current.contains(target))
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

  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const style: React.CSSProperties = {
      position: 'fixed',
      top: rect.bottom + 2,
      visibility: 'visible'
    };
    if (align === 'right') {
      style.right = window.innerWidth - rect.right;
    } else {
      style.left = rect.left;
    }
    setMenuStyle(style);
  }, [align]);

  useLayoutEffect(() => {
    if (!isOpen || !containerRef.current) {
      return;
    }
    updatePosition();
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  useLayoutEffect(() => {
    if (isOpen && menuRef.current) {
      menuRef.current.focus();
    }
  }, [isOpen]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    handleDropdownMenuKeyboard({
      event,
      menuRef,
      focusedIndex,
      setFocusedIndex
    });
  };

  const getContainerElement = useCallback(() => containerRef.current, []);

  const contextValue = useMemo<DropdownMenuContextValue>(
    () => ({ close, getContainerElement }),
    [close, getContainerElement]
  );

  return (
    <DropdownMenuContext.Provider value={contextValue}>
      <div ref={containerRef} className="relative" data-no-window-focus="true">
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
        {isOpen &&
          createPortal(
            <div
              ref={menuRef}
              role="menu"
              tabIndex={-1}
              onKeyDown={handleMenuKeyDown}
              data-no-window-focus="true"
              style={{ ...menuStyle, zIndex: DROPDOWN_MENU_Z_INDEX }}
              className="dropdown-menu min-w-32 whitespace-nowrap border bg-background py-1 shadow-sm outline-none [border-color:var(--soft-border)]"
              data-align={align}
            >
              {Children.map(children, (child) => {
                if (isValidElement<ChildProps>(child)) {
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
            </div>,
            document.body
          )}
      </div>
    </DropdownMenuContext.Provider>
  );
}

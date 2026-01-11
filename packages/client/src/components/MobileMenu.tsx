import { MoreVertical } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTypedTranslation } from '@/i18n';
import { navItems } from './Sidebar';

export function MobileMenu() {
  const { t } = useTypedTranslation('menu');
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const menuItems = useMemo(
    () => navItems.filter((item) => item.inMobileMenu),
    []
  );

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

  // Close menu on window resize to prevent misalignment
  useEffect(() => {
    if (!isOpen) return;

    const handleResize = () => closeDropdown();
    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen, closeDropdown]);

  return (
    <div className="relative lg:hidden">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleDropdown}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
        aria-label="Navigation menu"
        aria-expanded={isOpen}
        aria-haspopup="true"
        data-testid="mobile-menu-button"
      >
        <MoreVertical className="h-5 w-5" />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="fixed inset-0 cursor-default"
            onClick={closeDropdown}
            aria-label="Close navigation menu"
          />
          <div
            ref={menuRef}
            className="fixed z-10 min-w-48 rounded-md border bg-background py-1 shadow-lg"
            style={{ top: menuPosition.top, right: menuPosition.right }}
            role="menu"
            data-testid="mobile-menu-dropdown"
          >
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent ${
                    isActive ? 'bg-accent/50 font-medium' : ''
                  }`}
                  onClick={closeDropdown}
                  role="menuitem"
                  data-testid={item.testId}
                >
                  <Icon className="h-4 w-4" />
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

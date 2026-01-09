import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/useTheme.js';
import { cn } from '../lib/utils.js';

export interface ThemeSwitcherProps {
  className?: string;
  showSystemOption?: boolean;
  size?: 'sm' | 'default' | 'lg';
}

export function ThemeSwitcher({
  className,
  showSystemOption = false,
  size = 'default'
}: ThemeSwitcherProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const iconSize = {
    sm: 'h-4 w-4',
    default: 'h-5 w-5',
    lg: 'h-6 w-6'
  }[size];

  const buttonSize = {
    sm: 'h-8 w-8',
    default: 'h-9 w-9',
    lg: 'h-10 w-10'
  }[size];

  const handleToggle = () => {
    if (showSystemOption) {
      const nextTheme =
        theme === 'light'
          ? 'dark'
          : theme === 'dark'
            ? 'tokyo-night'
            : theme === 'tokyo-night'
              ? 'system'
              : 'light';
      setTheme(nextTheme);
    } else {
      setTheme(resolvedTheme === 'light' ? 'dark' : 'light');
    }
  };

  const Icon = resolvedTheme === 'light' ? Moon : Sun;

  const label = `Toggle theme (current: ${resolvedTheme})`;

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={cn(
        'inline-flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground',
        buttonSize,
        className
      )}
      aria-label={label}
      data-testid="theme-switcher"
    >
      <Icon className={iconSize} />
    </button>
  );
}

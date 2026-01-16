/**
 * Terminal input component with prompt display.
 * Handles both command input and password input modes.
 */

import type { ChangeEvent, KeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { InputMode } from '../lib/types';

interface TerminalInputProps {
  value: string;
  prompt: string;
  mode: InputMode;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
}

export function TerminalInput({
  value,
  prompt,
  mode,
  disabled = false,
  onChange,
  onSubmit,
  onKeyDown,
  className
}: TerminalInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when not disabled
  useEffect(() => {
    if (!disabled && inputRef.current) {
      inputRef.current.focus();
    }
  }, [disabled]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !disabled) {
      e.preventDefault();
      onSubmit();
    }

    onKeyDown?.(e);
  };

  const isPasswordMode = mode === 'password';

  return (
    <div className={cn('flex items-center font-mono text-sm', className)}>
      <span
        className="select-none text-emerald-400"
        data-testid="terminal-prompt"
      >
        {prompt}
      </span>
      <input
        ref={inputRef}
        type={isPasswordMode ? 'password' : 'text'}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={cn(
          'flex-1 bg-transparent text-base text-zinc-100 outline-none',
          'placeholder:text-zinc-600',
          disabled && 'cursor-not-allowed opacity-50'
        )}
        autoComplete={isPasswordMode ? 'current-password' : 'off'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        data-testid="terminal-input"
        aria-label={isPasswordMode ? 'Password input' : 'Command input'}
      />
    </div>
  );
}

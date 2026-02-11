import { BookUser } from 'lucide-react';
import type { RefObject } from 'react';

interface RecipientInputProps {
  label: string;
  inputId: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  addressBookDisabled: boolean;
  inputTestId: string;
  addressBookTestId: string;
  addressBookAriaLabel: string;
  onValueChange: (value: string) => void;
  onAddressBookClick: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function RecipientInput({
  label,
  inputId,
  value,
  placeholder,
  disabled,
  addressBookDisabled,
  inputTestId,
  addressBookTestId,
  addressBookAriaLabel,
  onValueChange,
  onAddressBookClick,
  inputRef
}: RecipientInputProps) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={inputId} className="w-12 text-muted-foreground text-sm">
        {label}
      </label>
      <div className="flex-1">
        <div className="flex items-center gap-3 rounded-md border bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            autoComplete="off"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent py-2 text-base focus:outline-none"
            disabled={disabled}
            data-testid={inputTestId}
          />
          <button
            type="button"
            onClick={onAddressBookClick}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label={addressBookAriaLabel}
            disabled={addressBookDisabled}
            data-testid={addressBookTestId}
          >
            <BookUser className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

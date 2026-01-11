import { Check, Loader2, Pencil, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface EditableTitleProps {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  'data-testid'?: string;
}

export function EditableTitle({
  value,
  onSave,
  'data-testid': dataTestId
}: EditableTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedValue, setEditedValue] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const originalValueRef = useRef<string>(value);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleEditClick = useCallback(() => {
    originalValueRef.current = value;
    setEditedValue(value);
    setError(null);
    setIsEditing(true);
  }, [value]);

  const handleCancel = useCallback(() => {
    setEditedValue(value);
    setError(null);
    setIsEditing(false);
  }, [value]);

  const handleSave = useCallback(async () => {
    const trimmed = editedValue.trim();
    if (!trimmed) {
      setError('Name cannot be empty');
      return;
    }

    if (trimmed === originalValueRef.current) {
      setIsEditing(false);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave(trimmed);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [editedValue, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [handleSave, handleCancel]
  );

  if (isEditing) {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <Input
            ref={inputRef}
            type="text"
            value={editedValue}
            onChange={(e) => setEditedValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={saving}
            className="flex-1 font-bold text-2xl tracking-tight"
            data-testid={dataTestId ? `${dataTestId}-input` : undefined}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCancel}
            disabled={saving}
            className="shrink-0"
            aria-label="Cancel"
            data-testid={dataTestId ? `${dataTestId}-cancel` : undefined}
          >
            <X className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSave}
            disabled={saving}
            className="shrink-0"
            aria-label="Save"
            data-testid={dataTestId ? `${dataTestId}-save` : undefined}
          >
            {saving ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Check className="h-5 w-5" />
            )}
          </Button>
        </div>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <h1
        className="flex-1 font-bold text-2xl tracking-tight"
        data-testid={dataTestId}
      >
        {value}
      </h1>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleEditClick}
        className="shrink-0"
        aria-label="Edit name"
        data-testid={dataTestId ? `${dataTestId}-edit` : undefined}
      >
        <Pencil className="h-5 w-5" />
      </Button>
    </div>
  );
}

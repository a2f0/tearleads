import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useTypedTranslation } from '@/i18n';
import { api } from '@tearleads/api-client';

interface CreateOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export function CreateOrganizationDialog({
  open,
  onOpenChange,
  onCreated
}: CreateOrganizationDialogProps) {
  const { t } = useTypedTranslation('admin');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setError(null);
      setTimeout(() => nameInputRef.current?.focus(), 0);
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onOpenChange(false);
      }
    },
    [loading, onOpenChange]
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const trimmedDescription = description.trim();
      await api.admin.organizations.create(
        trimmedDescription
          ? { name: name.trim(), description: trimmedDescription }
          : { name: name.trim() }
      );
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      if (err instanceof Error && err.message.includes('409')) {
        setError('An organization with this name already exists');
      } else {
        setError(
          err instanceof Error ? err.message : 'Failed to create organization'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => !loading && onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-organization-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="create-organization-title" className="font-semibold text-lg">
          Create Organization
        </h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Create a new organization to group users and teams.
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
          <div className="space-y-2">
            <label htmlFor="org-name" className="font-medium text-sm">
              Name
            </label>
            <Input
              ref={nameInputRef}
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('enterOrganizationName')}
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="org-description" className="font-medium text-sm">
              Description (optional)
            </label>
            <Textarea
              id="org-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('enterOrganizationDescription')}
              disabled={loading}
              rows={3}
            />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

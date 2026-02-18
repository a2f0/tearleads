import { api } from '@tearleads/api-client';
import type { AdminScopeOrganization } from '@tearleads/shared';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useTypedTranslation } from '@/i18n';

const EMPTY_ORGANIZATIONS: AdminScopeOrganization[] = [];

interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  organizations?: AdminScopeOrganization[];
  defaultOrganizationId?: string | null;
}

export function CreateGroupDialog({
  open,
  onOpenChange,
  onCreated,
  organizations = EMPTY_ORGANIZATIONS,
  defaultOrganizationId = null
}: CreateGroupDialogProps) {
  const { t } = useTypedTranslation('admin');
  const [name, setName] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const hasOrganizationOptions = organizations.length > 0;

  useEffect(() => {
    if (open) {
      setName('');
      setOrganizationId(defaultOrganizationId ?? organizations[0]?.id ?? '');
      setDescription('');
      setError(null);
      setTimeout(() => nameInputRef.current?.focus(), 0);
    }
  }, [defaultOrganizationId, open, organizations]);

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
      setError(t('nameIsRequired'));
      return;
    }

    if (!organizationId.trim()) {
      setError(t('organizationIdIsRequired'));
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const trimmedDescription = description.trim();
      const trimmedOrganizationId = organizationId.trim();
      await api.admin.groups.create(
        trimmedDescription
          ? {
              name: name.trim(),
              description: trimmedDescription,
              organizationId: trimmedOrganizationId
            }
          : { name: name.trim(), organizationId: trimmedOrganizationId }
      );
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      if (err instanceof Error && err.message.includes('409')) {
        setError(t('groupWithNameExists'));
      } else {
        setError(err instanceof Error ? err.message : t('failedToLoadGroups'));
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
        aria-labelledby="create-group-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id="create-group-title" className="font-semibold text-lg">
          {t('createGroup')}
        </h2>
        <p className="mt-1 text-muted-foreground text-sm">
          {t('createGroupDescription')}
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
          <div className="space-y-2">
            <label htmlFor="group-name" className="font-medium text-sm">
              {t('name')}
            </label>
            <Input
              ref={nameInputRef}
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('enterGroupName')}
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="group-description" className="font-medium text-sm">
              {t('descriptionOptional')}
            </label>
            <Textarea
              id="group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('enterGroupDescription')}
              disabled={loading}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="group-org" className="font-medium text-sm">
              {t('organizationId')}
            </label>
            {hasOrganizationOptions ? (
              <select
                id="group-org"
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
                disabled={loading}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-base text-foreground"
              >
                <option value="">{t('selectOrganization')}</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="group-org"
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
                placeholder={t('enterOrganizationId')}
                disabled={loading}
              />
            )}
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('create')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

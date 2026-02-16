import { Cake, Download, Loader2, Pencil, Save, User, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ContactFormData, ContactInfo } from './types';

interface ContactDetailHeaderProps {
  contact: ContactInfo;
  isEditing: boolean;
  formData: ContactFormData | null;
  saving: boolean;
  exporting: boolean;
  onEditClick: () => void;
  onCancel: () => void;
  onSave: () => void;
  onExport: () => void;
  onFormChange: (field: keyof ContactFormData, value: string) => void;
}

export function ContactDetailHeader({
  contact,
  isEditing,
  formData,
  saving,
  exporting,
  onEditClick,
  onCancel,
  onSave,
  onExport,
  onFormChange
}: ContactDetailHeaderProps) {
  const { t } = useTranslation('contacts');

  const displayName = `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`;

  return (
    <div className="flex items-start gap-4">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-muted">
        <User className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        {isEditing && formData ? (
          <div className="space-y-3">
            <Input
              type="text"
              value={formData.firstName}
              onChange={(e) => onFormChange('firstName', e.target.value)}
              placeholder={t('firstNameRequired')}
              data-testid="edit-first-name"
            />
            <Input
              type="text"
              value={formData.lastName}
              onChange={(e) => onFormChange('lastName', e.target.value)}
              placeholder={t('lastName')}
              data-testid="edit-last-name"
            />
            <div className="flex items-center gap-2">
              <Cake className="h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                value={formData.birthday}
                onChange={(e) => onFormChange('birthday', e.target.value)}
                placeholder={t('birthdayPlaceholder')}
                className="flex-1"
                data-testid="edit-birthday"
              />
            </div>
          </div>
        ) : (
          <div>
            <h1 className="font-bold text-2xl tracking-tight">{displayName}</h1>
            {contact.birthday && (
              <p className="mt-1 flex items-center gap-1 text-muted-foreground text-sm">
                <Cake className="h-4 w-4" />
                {contact.birthday}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="shrink-0">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={saving}
              data-testid="cancel-button"
            >
              <X className="mr-2 h-4 w-4" />
              {t('cancel')}
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              disabled={saving}
              data-testid="save-button"
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {t('save')}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              disabled={exporting}
              data-testid="export-button"
            >
              {exporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {t('export')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onEditClick}
              data-testid="edit-button"
            >
              <Pencil className="mr-2 h-4 w-4" />
              {t('edit')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

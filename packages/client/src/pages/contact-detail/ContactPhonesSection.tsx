import { Phone, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ContactPhone, PhoneFormData } from './types';

interface ContactPhonesSectionProps {
  isEditing: boolean;
  phones: ContactPhone[];
  phonesForm: PhoneFormData[];
  onPhoneChange: (
    phoneId: string,
    field: keyof PhoneFormData,
    value: string | boolean
  ) => void;
  onPhonePrimaryChange: (phoneId: string) => void;
  onDeletePhone: (phoneId: string) => void;
  onAddPhone: () => void;
}

export function ContactPhonesSection({
  isEditing,
  phones,
  phonesForm,
  onPhoneChange,
  onPhonePrimaryChange,
  onDeletePhone,
  onAddPhone
}: ContactPhonesSectionProps) {
  const { t } = useTranslation('contacts');

  if (isEditing) {
    return (
      <div className="rounded-lg border">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">{t('phoneNumbers')}</h2>
        </div>
        <div className="divide-y">
          {phonesForm
            .filter((p) => !p.isDeleted)
            .map((phone) => (
              <div key={phone.id} className="flex items-center gap-2 px-4 py-3">
                <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  type="tel"
                  value={phone.phoneNumber}
                  onChange={(e) =>
                    onPhoneChange(phone.id, 'phoneNumber', e.target.value)
                  }
                  placeholder={t('phoneNumber')}
                  className="min-w-0 flex-1"
                  data-testid={`edit-phone-${phone.id}`}
                />
                <Input
                  type="text"
                  value={phone.label}
                  onChange={(e) =>
                    onPhoneChange(phone.id, 'label', e.target.value)
                  }
                  placeholder={t('label')}
                  className="w-24"
                  data-testid={`edit-phone-label-${phone.id}`}
                />
                <label className="flex shrink-0 items-center gap-1 text-base">
                  <input
                    type="radio"
                    name="primaryPhone"
                    checked={phone.isPrimary}
                    onChange={() => onPhonePrimaryChange(phone.id)}
                    className="h-5 w-5"
                  />
                  {t('primary')}
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDeletePhone(phone.id)}
                  className="h-8 w-8 shrink-0"
                  data-testid={`delete-phone-${phone.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
        </div>
        <div className="border-t px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onAddPhone}
            data-testid="add-phone-button"
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('addPhone')}
          </Button>
        </div>
      </div>
    );
  }

  if (phones.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">{t('phoneNumbers')}</h2>
      </div>
      <div className="divide-y">
        {phones.map((phone) => (
          <div key={phone.id} className="flex items-center gap-3 px-4 py-3">
            <Phone className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <a
                href={`tel:${phone.phoneNumber}`}
                className="text-sm hover:underline"
              >
                {phone.phoneNumber}
              </a>
              {phone.label && (
                <span className="ml-2 text-muted-foreground text-xs">
                  ({phone.label})
                </span>
              )}
            </div>
            {phone.isPrimary && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs">
                {t('primary')}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

import { Phone, Plus, Trash2 } from 'lucide-react';
import { useContactsContext, useContactsUI } from '../../context';
import type { PhoneFormData } from '../contact-detail/types';

interface PhoneNumbersSectionProps {
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

export function PhoneNumbersSection({
  phonesForm,
  onPhoneChange,
  onPhonePrimaryChange,
  onDeletePhone,
  onAddPhone
}: PhoneNumbersSectionProps) {
  const { t } = useContactsContext();
  const { Button, Input } = useContactsUI();

  return (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">{t('phoneNumbers')}</h2>
      </div>
      <div className="divide-y">
        {phonesForm.map((phone) => (
          <div key={phone.id} className="space-y-3 px-4 py-3">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Input
                type="tel"
                value={phone.phoneNumber}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onPhoneChange(phone.id, 'phoneNumber', e.target.value)
                }
                placeholder={t('phoneNumber')}
                className="min-w-0 flex-1"
                data-testid={`new-phone-${phone.id}`}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-6">
              <Input
                type="text"
                value={phone.label}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onPhoneChange(phone.id, 'label', e.target.value)
                }
                placeholder={t('label')}
                className="w-full sm:w-32"
                data-testid={`new-phone-label-${phone.id}`}
              />
              <label className="flex shrink-0 items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="primaryPhone"
                  checked={phone.isPrimary}
                  onChange={() => onPhonePrimaryChange(phone.id)}
                  className="h-4 w-4"
                />
                {t('primary')}
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDeletePhone(phone.id)}
                className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                data-testid={`delete-phone-${phone.id}`}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {t('delete')}
              </Button>
            </div>
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

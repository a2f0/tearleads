import { Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ContactEditableListSection } from './ContactEditableListSection';
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

  return (
    <ContactEditableListSection
      isEditing={isEditing}
      items={phones}
      formItems={phonesForm}
      icon={Phone}
      sectionTitle={t('phoneNumbers')}
      inputType="tel"
      inputPlaceholder={t('phoneNumber')}
      addButtonLabel={t('addPhone')}
      primaryRadioName="primaryPhone"
      valueField="phoneNumber"
      getDisplayValue={(item) => item.phoneNumber}
      getLinkHref={(value) => `tel:${value}`}
      testIdPrefix="phone"
      onValueChange={onPhoneChange}
      onPrimaryChange={onPhonePrimaryChange}
      onDelete={onDeletePhone}
      onAdd={onAddPhone}
    />
  );
}

export interface ContactInfo {
  id: string;
  firstName: string;
  lastName: string | null;
  birthday: string | null;
  createdAt: Date;
  updatedAt: Date;
  deleted: boolean;
}

export interface ContactEmail {
  id: string;
  contactId: string;
  email: string;
  label: string | null;
  isPrimary: boolean;
}

export interface ContactPhone {
  id: string;
  contactId: string;
  phoneNumber: string;
  label: string | null;
  isPrimary: boolean;
}

export interface ContactFormData {
  firstName: string;
  lastName: string;
  birthday: string;
}

export interface EmailFormData {
  id: string;
  email: string;
  label: string;
  isPrimary: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
}

export interface PhoneFormData {
  id: string;
  phoneNumber: string;
  label: string;
  isPrimary: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
}

export interface UseContactDetailResult {
  isUnlocked: boolean;
  isLoading: boolean;
  contact: ContactInfo | null;
  emails: ContactEmail[];
  phones: ContactPhone[];
  loading: boolean;
  error: string | null;
  isEditing: boolean;
  formData: ContactFormData | null;
  emailsForm: EmailFormData[];
  phonesForm: PhoneFormData[];
  saving: boolean;
  exporting: boolean;
  t: (key: string) => string;
  handleExport: () => Promise<void>;
  handleEditClick: () => void;
  handleCancel: () => void;
  handleSave: () => Promise<void>;
  handleFormChange: (field: keyof ContactFormData, value: string) => void;
  handleEmailChange: (
    emailId: string,
    field: keyof EmailFormData,
    value: string | boolean
  ) => void;
  handleEmailPrimaryChange: (emailId: string) => void;
  handleDeleteEmail: (emailId: string) => void;
  handleAddEmail: () => void;
  handlePhoneChange: (
    phoneId: string,
    field: keyof PhoneFormData,
    value: string | boolean
  ) => void;
  handlePhonePrimaryChange: (phoneId: string) => void;
  handleDeletePhone: (phoneId: string) => void;
  handleAddPhone: () => void;
}

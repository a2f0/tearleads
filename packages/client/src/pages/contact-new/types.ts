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
}

export interface PhoneFormData {
  id: string;
  phoneNumber: string;
  label: string;
  isPrimary: boolean;
}

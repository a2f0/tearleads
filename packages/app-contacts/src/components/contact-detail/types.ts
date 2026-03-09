/**
 * Types for ContactsWindowDetail component.
 */

export interface ContactInfo {
  id: string;
  firstName: string;
  lastName: string | null;
  birthday: string | null;
  createdAt: Date;
  updatedAt: Date;
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

export interface ContactsWindowDetailProps {
  contactId: string;
  onDeleted: () => void;
}

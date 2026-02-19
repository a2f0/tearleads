/**
 * Types and constants for Contacts page.
 */

export interface ContactInfo {
  id: string;
  firstName: string;
  lastName: string | null;
  birthday: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  createdAt: Date;
}

export const ROW_HEIGHT_ESTIMATE = 72;

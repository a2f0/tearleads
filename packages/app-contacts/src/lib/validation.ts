/** Email validation regex - checks for basic email format */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Email form data structure */
export interface EmailFormData {
  id: string;
  email: string;
  label: string;
  isPrimary: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
}

/** Phone form data structure */
export interface PhoneFormData {
  id: string;
  phoneNumber: string;
  label: string;
  isPrimary: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
}

/** Contact form data structure */
export interface ContactFormData {
  firstName: string;
  lastName: string;
  birthday: string;
}

/** Validation result with all errors collected */
interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validate contact form data, collecting all errors.
 * Returns all validation errors at once for better UX.
 */
export function validateContactForm(
  formData: ContactFormData,
  emails: EmailFormData[],
  phones: PhoneFormData[]
): ValidationResult {
  const errors: string[] = [];

  // Validate first name
  if (!formData.firstName.trim()) {
    errors.push('First name is required.');
  }

  // Validate emails (filter out deleted for edit mode)
  const activeEmails = emails.filter((e) => !e.isDeleted);
  for (let i = 0; i < activeEmails.length; i++) {
    const email = activeEmails[i];
    if (email) {
      if (!email.email.trim()) {
        errors.push(`Email #${i + 1} cannot be empty.`);
      } else if (!EMAIL_REGEX.test(email.email.trim())) {
        errors.push(`Email #${i + 1} is not a valid email address.`);
      }
    }
  }

  // Validate phones (filter out deleted for edit mode)
  const activePhones = phones.filter((p) => !p.isDeleted);
  for (let i = 0; i < activePhones.length; i++) {
    const phone = activePhones[i];
    if (phone) {
      if (!phone.phoneNumber.trim()) {
        errors.push(`Phone #${i + 1} cannot be empty.`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

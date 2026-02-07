/**
 * Types for email composition functionality
 */

/**
 * Email attachment metadata
 */
export interface Attachment {
  /** Unique identifier */
  id: string;
  /** Original file name */
  fileName: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Base64-encoded content (for unsaved attachments) */
  content?: string;
  /** Reference to local File object (for pending uploads) */
  file?: File;
}

/**
 * Draft email stored on server
 */
export interface DraftEmail {
  /** Unique identifier */
  id: string;
  /** Recipient email addresses */
  to: string[];
  /** CC email addresses */
  cc: string[];
  /** BCC email addresses */
  bcc: string[];
  /** Email subject */
  subject: string;
  /** Email body (plain text) */
  body: string;
  /** Attachments */
  attachments: Attachment[];
  /** ISO timestamp when draft was created */
  createdAt: string;
  /** ISO timestamp when draft was last updated */
  updatedAt: string;
}

/**
 * Draft list item (summary for list view)
 */
export interface DraftListItem {
  /** Unique identifier */
  id: string;
  /** Recipient email addresses */
  to: string[];
  /** Email subject */
  subject: string;
  /** ISO timestamp when draft was last updated */
  updatedAt: string;
}

/**
 * Local compose form state
 */
export interface ComposeState {
  /** Draft ID (null for new compose) */
  draftId: string | null;
  /** Comma-separated recipient addresses */
  to: string;
  /** Comma-separated CC addresses */
  cc: string;
  /** Comma-separated BCC addresses */
  bcc: string;
  /** Email subject */
  subject: string;
  /** Email body */
  body: string;
  /** Attachments pending upload or already saved */
  attachments: Attachment[];
  /** Whether form has unsaved changes */
  isDirty: boolean;
  /** Whether draft is currently being saved */
  isSaving: boolean;
  /** Whether email is currently being sent */
  isSending: boolean;
  /** ISO timestamp when draft was last auto-saved */
  lastSavedAt: string | null;
  /** Error message if save/send failed */
  error: string | null;
}

/**
 * Initial compose state for new emails
 */
export const initialComposeState: ComposeState = {
  draftId: null,
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  body: '',
  attachments: [],
  isDirty: false,
  isSaving: false,
  isSending: false,
  lastSavedAt: null,
  error: null
};

/**
 * Parse comma-separated email string into array
 */
export function parseEmailAddresses(input: string): string[] {
  return input
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}

/**
 * Format email array into comma-separated string
 */
export function formatEmailAddresses(emails: string[]): string {
  return emails.join(', ');
}

/**
 * Basic email validation
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate all email addresses in a comma-separated string
 */
export function validateEmailAddresses(input: string): {
  valid: boolean;
  invalidEmails: string[];
} {
  const emails = parseEmailAddresses(input);
  const invalidEmails = emails.filter((email) => !isValidEmail(email));
  return {
    valid: invalidEmails.length === 0,
    invalidEmails
  };
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

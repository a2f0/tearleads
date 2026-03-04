export interface EmailAttachmentPart {
  filename: string;
  mimeType: string;
  size: number;
  contentId: string | null;
}

export interface ParsedEmailBody {
  text: string | null;
  html: string | null;
  attachments: EmailAttachmentPart[];
}

export type EmailBodyViewMode = 'html' | 'text';

import type { Transporter, TransportOptions } from 'nodemailer';
import nodemailer from 'nodemailer';

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType: string;
}

interface EmailMessage {
  from?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: {
    user: string;
    pass: string;
  };
}

let transporter: Transporter | null = null;

function getSmtpConfig(): SmtpConfig {
  const host = process.env['SMTP_HOST'] ?? 'localhost';
  const port = Number(process.env['SMTP_OUTBOUND_PORT'] ?? 587);
  const secure = process.env['SMTP_SECURE'] === 'true';
  const user = process.env['SMTP_USER'];
  const pass = process.env['SMTP_PASS'];

  const config: SmtpConfig = {
    host,
    port,
    secure
  };

  if (user && pass) {
    config.auth = { user, pass };
  }

  return config;
}

export function getEmailTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport(
      getSmtpConfig() as TransportOptions
    );
  }
  return transporter;
}

export function resetEmailTransporter(): void {
  transporter = null;
}

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const transport = getEmailTransporter();
  const fromAddress =
    message.from ?? process.env['SMTP_FROM_ADDRESS'] ?? 'noreply@localhost';

  try {
    const result = await transport.sendMail({
      from: fromAddress,
      to: message.to.join(', '),
      cc: message.cc?.join(', '),
      bcc: message.bcc?.join(', '),
      subject: message.subject,
      text: message.text,
      attachments: message.attachments?.map((att) => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType
      }))
    });

    return {
      success: true,
      messageId: result.messageId
    };
  } catch (error) {
    console.error('Failed to send email:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function verifySmtpConnection(): Promise<boolean> {
  try {
    const transport = getEmailTransporter();
    await transport.verify();
    return true;
  } catch (error) {
    console.error('Failed to verify SMTP connection:', error);
    return false;
  }
}

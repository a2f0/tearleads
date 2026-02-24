import type { InboundMessageIngestor } from './inboundContracts.js';

export interface EmailAddress {
  address: string;
  name?: string;
}

export interface EmailEnvelope {
  mailFrom: EmailAddress | false;
  rcptTo: EmailAddress[];
}

export interface StoredEmail {
  id: string;
  envelope: EmailEnvelope;
  rawData: string;
  receivedAt: string;
  size: number;
}

export interface SmtpListenerConfig {
  port: number;
  host?: string;
  maxMessageSize?: number;
  recipientDomains?: string[];
  /**
   * Controls recipient local-part parsing for user identity resolution.
   * - `uuid-local-part` (default): requires canonical user UUID local-part.
   * - `legacy-local-part`: accepts any non-empty local-part.
   */
  recipientAddressing?: 'uuid-local-part' | 'legacy-local-part';
  inboundIngestor?: InboundMessageIngestor;
  onEmail?: (email: StoredEmail) => void | Promise<void>;
}

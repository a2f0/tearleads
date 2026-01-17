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
  redisUrl?: string;
  maxMessageSize?: number;
  onEmail?: (email: StoredEmail) => void | Promise<void>;
}
